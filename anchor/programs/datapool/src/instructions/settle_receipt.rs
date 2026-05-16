use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
    ID as INSTRUCTIONS_SYSVAR_ID,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{
        v1::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{PackedAddressTreeInfo, ValidityProof},
    PackedAddressTreeInfoExt,
};

use crate::error::DataPoolError;
use crate::receipt::JoinReceipt;
use crate::state::{CompressedBuyerSlot, DataPool};

/// Solana's native Ed25519 sig-verify program. The ix's mere presence in
/// the tx (with matching signature/pubkey/message) proves the buyer
/// authorized this receipt — Solana aborts the entire tx on sig failure.
const ED25519_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("Ed25519SigVerify111111111111111111111111111");

/// Settle a single off-chain JoinReceipt on-chain.
///
/// Authorization model:
///   - Buyer signed the canonical 104-byte receipt off-chain (Ed25519).
///   - Keeper bundles 1..K of these into a transaction, prepending an
///     Ed25519Program instruction per receipt.
///   - This instruction reads the instructions sysvar, confirms a matching
///     Ed25519 ix exists for THIS receipt's (pubkey, message).
///
/// Funds flow:
///   - Buyer pre-approved the protocol-wide `protocol_delegate` PDA on
///     their USDC ATA (single approval covers all pools).
///   - This instruction CPIs `token::transfer` signed by that PDA, pulling
///     `current_price(now)` micro-USDC from the buyer's ATA into pool escrow.
///
/// Storage:
///   - BuyerSlot is stored as a **compressed leaf** in Light Protocol's
///     state Merkle tree — no per-buyer rent. The address is derived
///     deterministically from `["buyer_slot", pool_key, buyer]`, so the
///     Light system program rejects any second insert at the same address
///     (replay protection without an on-chain account).
///
/// Light Protocol arguments:
///   - `proof`: ValidityProof generated off-chain by Photon RPC, attesting
///     that the new address doesn't already exist in the address tree.
///   - `address_tree_info`: which address tree to use + insertion path.
///   - `output_tree_index`: index into `remaining_accounts` for the state
///     tree where the new BuyerSlot leaf is written.
#[derive(Accounts)]
#[instruction(receipt: JoinReceipt)]
pub struct SettleReceipt<'info> {
    #[account(
        mut,
        seeds = [b"data_pool", receipt.pool_hash.as_ref()],
        bump = pool.bump,
        constraint = pool.is_open @ DataPoolError::PoolClosed,
    )]
    pub pool: Account<'info, DataPool>,

    /// CHECK: identity verified by the Ed25519 instruction + `address` constraint.
    /// Buyer is NOT a signer — the receipt-based authorization model is the whole point.
    #[account(address = receipt.buyer)]
    pub buyer: UncheckedAccount<'info>,

    /// Buyer's USDC token account. `protocol_delegate` PDA must already be
    /// a delegate here with `delegated_amount >= current_price`; the SPL
    /// token program enforces this at transfer time.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(mut, address = pool.escrow)]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// CHECK: Protocol-wide delegate PDA the buyer pre-approved on their
    /// USDC ATA. Single approval (with a spending cap) authorizes settlement
    /// across every pool — derived from the program ID alone, not per-pool.
    #[account(
        seeds = [b"protocol_delegate"],
        bump,
    )]
    pub protocol_delegate: UncheckedAccount<'info>,

    /// Keeper pays for tx fee. With compressed BuyerSlot, the per-buyer
    /// account-rent cost is gone — keeper only pays the tx + Light CPI fee.
    #[account(mut, address = pool.keeper)]
    pub keeper: Signer<'info>,

    /// CHECK: Solana instructions sysvar — read-only, address-checked.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    // Light system program + state/address tree accounts arrive via
    // ctx.remaining_accounts in the order packed by the keeper client.
}

pub fn handle_settle_receipt<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleReceipt<'info>>,
    receipt: JoinReceipt,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_tree_index: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(receipt.deadline >= now, DataPoolError::ReceiptExpired);
    require!(
        receipt.pool_hash == ctx.accounts.pool.request_hash,
        DataPoolError::ReceiptPoolMismatch
    );
    // Pool freshness expiry — `expires_at_ms == 0` means register_dataset has
    // not run yet (we're still in the pre-fetch sponsor window; expiry doesn't
    // apply). Once `expires_at_ms` is set, settling past it would commit a
    // buyer slot tied to a stale data_hash.
    require!(
        ctx.accounts.pool.expires_at_ms == 0
            || (now as i64).saturating_mul(1000) <= ctx.accounts.pool.expires_at_ms,
        DataPoolError::PoolExpired
    );

    verify_ed25519_authorization(&ctx.accounts.instructions_sysvar, &receipt)?;

    let pool_key = ctx.accounts.pool.key();
    // First `min_buyers` settlers are sponsors regardless of trigger_fetch
    // timing. Decouples sponsor classification from the off-chain ordering
    // of settle_receipt vs trigger_fetch — server can call trigger_fetch
    // first and the early receipts still get is_sponsor=true.
    let is_sponsor = ctx.accounts.pool.buyer_count < ctx.accounts.pool.min_buyers;

    let price = ctx.accounts.pool.current_price(now);
    require!(
        receipt.max_price >= price,
        DataPoolError::ReceiptPriceTooLow
    );

    // Pull USDC via PDA-signed delegated transfer.
    let delegate_bump = ctx.bumps.protocol_delegate;
    let signer_seeds: &[&[&[u8]]] = &[&[b"protocol_delegate", &[delegate_bump]]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.protocol_delegate.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(cpi_ctx, price)?;

    // Build CpiAccounts from the keeper signer + remaining_accounts (Light
    // packs the system program, state tree, address tree, queues, etc.).
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.keeper.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    // Deterministic compressed-account address: hash(seeds, address_tree, program_id).
    // Same (pool, buyer) pair always derives the same address, so the Light
    // system program will reject a second insert — this IS the replay check.
    let (address, address_seed) = derive_address(
        &[
            b"buyer_slot",
            pool_key.as_ref(),
            receipt.buyer.as_ref(),
        ],
        &address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| error!(DataPoolError::Overflow))?,
        &crate::ID,
    );
    let new_address_params = address_tree_info.into_new_address_params_packed(address_seed);

    let mut compressed_slot = LightAccount::<CompressedBuyerSlot>::new_init(
        &crate::ID,
        Some(address),
        output_tree_index,
    );
    compressed_slot.pool = pool_key;
    compressed_slot.buyer = receipt.buyer;
    compressed_slot.amount_paid = price;
    compressed_slot.joined_at = now;
    compressed_slot.is_sponsor = is_sponsor;
    compressed_slot.rebate_claimed = false;
    compressed_slot.rebate_amount = 0;
    compressed_slot.nonce = receipt.nonce;

    LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
        .with_light_account(compressed_slot)
        .map_err(|_| error!(DataPoolError::Overflow))?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)
        .map_err(|_| error!(DataPoolError::Overflow))?;

    // Update pool aggregates after the compressed write so a CPI failure
    // doesn't leak stale buyer counts.
    let pool = &mut ctx.accounts.pool;
    pool.total_collected = pool
        .total_collected
        .checked_add(price)
        .ok_or(DataPoolError::Overflow)?;
    pool.buyer_count = pool.buyer_count.saturating_add(1);
    if is_sponsor {
        // Track pre-fetch revenue separately — claim_rebate uses this to
        // derive post-fetch revenue (the rebate-able pool).
        pool.pre_fetch_collected = pool
            .pre_fetch_collected
            .checked_add(price)
            .ok_or(DataPoolError::Overflow)?;
    }

    msg!(
        "Settled receipt: buyer {} paid {} (sponsor: {}, nonce: {})",
        receipt.buyer,
        price,
        is_sponsor,
        receipt.nonce,
    );

    Ok(())
}

/// Walk back from the current instruction looking for the Ed25519Program
/// instruction that verified this receipt's signature. We don't require it
/// to be at any specific position — only that it exists earlier in the tx
/// and verified (pubkey == receipt.buyer, message == canonical_bytes).
///
/// The Ed25519 precompile aborts the entire transaction on signature
/// failure, so finding a matching ix is sufficient proof of authorization.
fn verify_ed25519_authorization(
    instructions_sysvar: &AccountInfo,
    receipt: &JoinReceipt,
) -> Result<()> {
    let current_idx = load_current_index_checked(instructions_sysvar)? as usize;
    require!(current_idx > 0, DataPoolError::EdVerifyMissing);

    let expected_msg = receipt.canonical_bytes();

    for idx in 0..current_idx {
        let ix = match load_instruction_at_checked(idx, instructions_sysvar) {
            Ok(ix) => ix,
            Err(_) => continue,
        };

        if ix.program_id != ED25519_PROGRAM_ID {
            continue;
        }

        if let Some(()) =
            try_match_ed25519_ix(&ix.data, &receipt.buyer, &expected_msg)
        {
            return Ok(());
        }
    }

    err!(DataPoolError::EdVerifyMissing)
}

/// Parse a single Ed25519Program instruction's data and check whether one
/// of its signature entries authorizes (pubkey, message). Returns Some(())
/// on match, None otherwise.
///
/// Ed25519Program ix layout:
///   [0]      num_signatures (u8)
///   [1]      padding
///   [2..]    14 bytes per signature (offsets) repeated num_signatures times
///   [...]    raw bytes referenced by offsets
fn try_match_ed25519_ix(
    data: &[u8],
    expected_pubkey: &Pubkey,
    expected_msg: &[u8],
) -> Option<()> {
    if data.len() < 2 {
        return None;
    }
    let num_sigs = data[0] as usize;
    if num_sigs == 0 {
        return None;
    }

    const ENTRY_SIZE: usize = 14;
    let header_size = 2 + num_sigs * ENTRY_SIZE;
    if data.len() < header_size {
        return None;
    }

    for i in 0..num_sigs {
        let off = 2 + i * ENTRY_SIZE;
        let pubkey_offset =
            u16::from_le_bytes([data[off + 4], data[off + 5]]) as usize;
        let pubkey_ix_idx =
            u16::from_le_bytes([data[off + 6], data[off + 7]]);
        let msg_offset =
            u16::from_le_bytes([data[off + 8], data[off + 9]]) as usize;
        let msg_size =
            u16::from_le_bytes([data[off + 10], data[off + 11]]) as usize;
        let msg_ix_idx =
            u16::from_le_bytes([data[off + 12], data[off + 13]]);

        if pubkey_ix_idx != u16::MAX || msg_ix_idx != u16::MAX {
            continue;
        }
        if msg_size != expected_msg.len() {
            continue;
        }
        if data.len() < pubkey_offset + 32 || data.len() < msg_offset + msg_size {
            continue;
        }

        let pubkey_slice = &data[pubkey_offset..pubkey_offset + 32];
        if pubkey_slice != expected_pubkey.as_ref() {
            continue;
        }

        let msg_slice = &data[msg_offset..msg_offset + msg_size];
        if msg_slice != expected_msg {
            continue;
        }

        return Some(());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::JoinReceipt;

    /// Build a synthetic Ed25519Program ix data blob with the given pubkey
    /// and message. Layout matches the precompile's expected format.
    fn build_ed25519_ix_data(pubkey: &[u8; 32], msg: &[u8]) -> Vec<u8> {
        const ENTRY_SIZE: usize = 14;
        const HEADER_SIZE: usize = 2 + ENTRY_SIZE;

        let sig_offset: u16 = HEADER_SIZE as u16;
        let pubkey_offset: u16 = sig_offset + 64;
        let msg_offset: u16 = pubkey_offset + 32;
        let msg_size: u16 = msg.len() as u16;

        let mut data = Vec::with_capacity(HEADER_SIZE + 64 + 32 + msg.len());
        data.push(1); // num_signatures
        data.push(0); // padding
        data.extend_from_slice(&sig_offset.to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&pubkey_offset.to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&msg_offset.to_le_bytes());
        data.extend_from_slice(&msg_size.to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend(std::iter::repeat(0u8).take(64));
        data.extend_from_slice(pubkey);
        data.extend_from_slice(msg);
        data
    }

    fn fixture_receipt() -> JoinReceipt {
        JoinReceipt {
            pool_hash: [0xAB; 32],
            buyer: Pubkey::new_from_array([0xCD; 32]),
            max_price: 1_000_000,
            nonce: 42,
            deadline: 2_000_000_000,
        }
    }

    #[test]
    fn parser_matches_well_formed_ix() {
        let r = fixture_receipt();
        let msg = r.canonical_bytes();
        let data = build_ed25519_ix_data(&r.buyer.to_bytes(), &msg);
        assert!(try_match_ed25519_ix(&data, &r.buyer, &msg).is_some());
    }

    #[test]
    fn parser_rejects_wrong_pubkey() {
        let r = fixture_receipt();
        let msg = r.canonical_bytes();
        let other = Pubkey::new_from_array([0x99; 32]);
        let data = build_ed25519_ix_data(&other.to_bytes(), &msg);
        assert!(try_match_ed25519_ix(&data, &r.buyer, &msg).is_none());
    }

    #[test]
    fn parser_rejects_wrong_message() {
        let r = fixture_receipt();
        let msg = r.canonical_bytes();
        let mut tampered = msg.to_vec();
        tampered[20] ^= 0xff;
        let data = build_ed25519_ix_data(&r.buyer.to_bytes(), &tampered);
        assert!(try_match_ed25519_ix(&data, &r.buyer, &msg).is_none());
    }

    #[test]
    fn parser_rejects_truncated_data() {
        let data = vec![1u8, 0];
        let r = fixture_receipt();
        let msg = r.canonical_bytes();
        assert!(try_match_ed25519_ix(&data, &r.buyer, &msg).is_none());
    }

    #[test]
    fn parser_rejects_zero_signatures() {
        let data = vec![0u8, 0];
        let r = fixture_receipt();
        let msg = r.canonical_bytes();
        assert!(try_match_ed25519_ix(&data, &r.buyer, &msg).is_none());
    }

    #[test]
    fn parser_rejects_external_data_refs() {
        let r = fixture_receipt();
        let msg = r.canonical_bytes();
        let mut data = build_ed25519_ix_data(&r.buyer.to_bytes(), &msg);
        data[6] = 0;
        data[7] = 0;
        assert!(try_match_ed25519_ix(&data, &r.buyer, &msg).is_none());
    }
}
