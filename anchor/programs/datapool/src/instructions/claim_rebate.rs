use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use light_sdk::{
    account::LightAccount,
    cpi::{
        v1::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use crate::error::DataPoolError;
use crate::state::{CompressedBuyerSlot, DataPool};

/// Sponsors (pre-fetch buyers) claim retroactive rebates from post-fetch revenue.
/// Rebate = (sponsor_paid / total_collected) * POST_FETCH_REVENUE * REBATE_SHARE_BPS / 10000
/// REBATE_SHARE_BPS = 3000 (30% of post-fetch revenue goes to sponsors).
pub const REBATE_SHARE_BPS: u64 = 3000;

/// The sponsor's BuyerSlot lives as a compressed leaf in Light Protocol's
/// state Merkle tree. To claim, the sponsor passes:
///   - `slot_meta`: which leaf they're updating (state tree, address, root)
///   - `slot_data`: the current leaf contents (so the program can verify
///     hash(slot_data) matches the leaf at slot_meta.address)
///   - `proof`: ValidityProof from Photon RPC for the leaf's existence
///   - light system + tree accounts in `remaining_accounts`
///
/// We mark the slot as claimed and update its `rebate_amount`. The Light
/// system program commits this as a "burn old leaf, insert new leaf" — so
/// the same sponsor can never claim twice.
#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct ClaimRebate<'info> {
    #[account(
        mut,
        seeds = [b"data_pool", request_hash.as_ref()],
        bump = pool.bump,
        constraint = pool.fetched_at != 0 @ DataPoolError::NotFetchedYet,
    )]
    pub pool: Account<'info, DataPool>,

    /// Pool escrow (PDA-owned) — source of rebate funds.
    #[account(mut, address = pool.escrow)]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Sponsor's USDC token account — receives rebate.
    #[account(mut)]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// PDA that owns the escrow.
    #[account(
        seeds = [b"escrow_authority", pool.key().as_ref()],
        bump,
    )]
    pub escrow_authority: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    // Light system program + state tree accounts arrive via ctx.remaining_accounts.
}

pub fn handle_claim_rebate<'info>(
    ctx: Context<'_, '_, '_, 'info, ClaimRebate<'info>>,
    _request_hash: [u8; 32],
    slot_meta: CompressedAccountMeta,
    slot_data: CompressedBuyerSlot,
    proof: ValidityProof,
) -> Result<()> {
    // Sanity: leaf data must reference this pool and this caller.
    require!(
        slot_data.pool == ctx.accounts.pool.key(),
        DataPoolError::ReceiptPoolMismatch
    );
    require!(
        slot_data.buyer == ctx.accounts.buyer.key(),
        DataPoolError::UnauthorizedClaim
    );
    require!(slot_data.is_sponsor, DataPoolError::NoRebateToClaim);
    require!(!slot_data.rebate_claimed, DataPoolError::NoRebateToClaim);

    // Construct the LightAccount in mutate mode — Light's CPI will verify
    // hash(slot_data) matches the leaf at slot_meta.address against the
    // state-tree root referenced by slot_meta.tree_info.
    let mut light_slot =
        LightAccount::<CompressedBuyerSlot>::new_mut(&crate::ID, &slot_meta, slot_data.clone())
            .map_err(|_| error!(DataPoolError::Overflow))?;

    let pool = &ctx.accounts.pool;

    // Calculate post-fetch revenue (mirrors the legacy logic).
    // Pre-fetch sponsors paid base_price; post-fetch buyers pay decayed price.
    let pre_fetch_collected = (pool.base_price_usdc as u128)
        .checked_mul(pool.buyer_count as u128)
        .unwrap_or(0);
    let total = pool.total_collected as u128;
    let post_fetch_revenue = total.saturating_sub(pre_fetch_collected) as u64;

    // Sponsor's proportional share = amount_paid / total_collected.
    let sponsor_share_num = slot_data.amount_paid as u128;
    let sponsor_share_den = pool.total_collected.max(1) as u128;

    let rebate_amount = (post_fetch_revenue as u128)
        .saturating_mul(REBATE_SHARE_BPS as u128)
        .saturating_div(10000)
        .saturating_mul(sponsor_share_num)
        .saturating_div(sponsor_share_den) as u64;

    require!(rebate_amount > 0, DataPoolError::NoRebateToClaim);

    // Invariant: total_distributed (sponsors + provider) <= total_collected.
    let new_distributed = pool
        .total_distributed
        .checked_add(rebate_amount)
        .ok_or(DataPoolError::Overflow)?;
    require!(
        new_distributed <= pool.total_collected,
        DataPoolError::Overflow
    );

    // Transfer rebate from escrow to sponsor (PDA-signed).
    let pool_key = pool.key();
    let authority_seeds: &[&[u8]] = &[
        b"escrow_authority",
        pool_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];
    let signer_seeds = &[authority_seeds];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.sponsor_token_account.to_account_info(),
            authority: ctx.accounts.escrow_authority.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(cpi_ctx, rebate_amount)?;

    // Mutate the compressed leaf — Light commits this via CPI below.
    light_slot.rebate_claimed = true;
    light_slot.rebate_amount = rebate_amount;

    // Update pool accounting.
    let pool_mut = &mut ctx.accounts.pool;
    pool_mut.total_distributed = new_distributed;

    // Commit the leaf update.
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.buyer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
        .with_light_account(light_slot)
        .map_err(|_| error!(DataPoolError::Overflow))?
        .invoke(light_cpi_accounts)
        .map_err(|_| error!(DataPoolError::Overflow))?;

    msg!(
        "Rebate claimed: {} USDC micro-units to sponsor {}",
        rebate_amount,
        ctx.accounts.buyer.key()
    );

    Ok(())
}
