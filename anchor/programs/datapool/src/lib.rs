use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[cfg(test)]
mod tests;

pub mod error;
pub mod instructions;
pub mod receipt;
pub mod state;

use instructions::*;
use state::{BuyerSlot, DataPool};

declare_id!("62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D");

// Bring CpiSigner into scope so the derive_light_cpi_signer! macro
// expansion (which references the bare ident) resolves correctly.
use light_sdk::CpiSigner;

/// Light Protocol CPI signer — derived at compile time from our program ID.
/// settle_receipt and claim_rebate use this when invoking the light system
/// program to insert / update compressed BuyerSlot leaves.
pub const LIGHT_CPI_SIGNER: CpiSigner =
    light_sdk::derive_light_cpi_signer!("62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D");

#[program]
pub mod datapool {
    use super::*;

    /// Initialize a new DataPool for a given data request.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        request_hash: [u8; 32],
        base_price_usdc: u64,
        min_buyers: u8,
        decay_bps_per_hour: u16,
        provider: Pubkey,
        provider_share_bps: u16,
        provider_decay_bps_per_hour: u16,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            decay_bps_per_hour > 0 && decay_bps_per_hour <= 10000,
            error::DataPoolError::InvalidDecayRate
        );

        // Provider + sponsor shares of post-fetch revenue must fit in 100%.
        // (REBATE_SHARE_BPS = 3000 reserved for sponsors via claim_rebate.)
        require!(
            (provider_share_bps as u64)
                .saturating_add(instructions::claim_rebate::REBATE_SHARE_BPS)
                <= 10000,
            error::DataPoolError::InvalidRevenueSplit
        );

        pool.request_hash = request_hash;
        pool.keeper = ctx.accounts.keeper.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.escrow = ctx.accounts.escrow.key();
        pool.base_price_usdc = base_price_usdc;
        pool.min_buyers = min_buyers;
        pool.buyer_count = 0;
        pool.total_collected = 0;
        pool.total_distributed = 0;
        pool.fetched_at = 0;
        pool.data_hash = [0u8; 32];
        pool.decay_bps_per_hour = decay_bps_per_hour;
        pool.is_open = true;
        pool.provider = provider;
        pool.provider_share_bps = provider_share_bps;
        pool.provider_decay_bps_per_hour = provider_decay_bps_per_hour;
        pool.provider_paid = 0;
        pool.pre_fetch_collected = 0;
        pool.storage_uri = String::new();
        pool.key_commitment = [0u8; 32];
        pool.bump = ctx.bumps.pool;

        msg!(
            "DataPool initialized. Request hash: {:?}. Provider: {}, share: {} bps, decay: {} bps/hr",
            request_hash,
            provider,
            provider_share_bps,
            provider_decay_bps_per_hour
        );
        Ok(())
    }

    /// Buyer joins the pool, paying the current (possibly decayed) price.
    pub fn join_pool(ctx: Context<JoinPool>, request_hash: [u8; 32]) -> Result<()> {
        instructions::handle_join_pool(ctx, request_hash)
    }

    /// Keeper triggers a data fetch after pool threshold is met.
    pub fn trigger_fetch(
        ctx: Context<TriggerFetch>,
        request_hash: [u8; 32],
        data_hash: [u8; 32],
    ) -> Result<()> {
        instructions::handle_trigger_fetch(ctx, request_hash, data_hash)
    }

    /// Keeper registers the dataset on-chain after fetching, opens pool to post-fetch buyers.
    pub fn register_dataset(
        ctx: Context<RegisterDataset>,
        request_hash: [u8; 32],
        storage_uri: String,
        key_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::handle_register_dataset(ctx, request_hash, storage_uri, key_commitment)
    }

    /// Early sponsor claims retroactive rebate from post-fetch buyer revenue.
    /// Reads + updates the sponsor's compressed BuyerSlot via Light Protocol;
    /// caller supplies the leaf data, account meta, and validity proof
    /// (obtained off-chain from a Photon RPC).
    pub fn claim_rebate<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimRebate<'info>>,
        request_hash: [u8; 32],
        slot_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        slot_data: state::CompressedBuyerSlot,
        proof: light_sdk::instruction::ValidityProof,
    ) -> Result<()> {
        instructions::handle_claim_rebate(ctx, request_hash, slot_meta, slot_data, proof)
    }

    /// Provider claims their time-decayed share of post-fetch revenue.
    /// Incremental: callable repeatedly as new buyers join, only marginal
    /// entitlement is paid each call.
    pub fn claim_provider_revenue(
        ctx: Context<ClaimProviderRevenue>,
        request_hash: [u8; 32],
    ) -> Result<()> {
        instructions::handle_claim_provider_revenue(ctx, request_hash)
    }

    /// Settle a buyer's off-chain JoinReceipt on-chain.
    /// Buyer authorized via Ed25519 signature on the canonical receipt bytes
    /// (verified by the preceding Ed25519Program ix). Keeper bundles 1..K
    /// of these into a single tx — no buyer wallet signature per join.
    ///
    /// Writes a compressed BuyerSlot leaf via Light Protocol — no per-buyer
    /// rent. The Light system program rejects re-insertion at the same
    /// derived address, providing replay protection without an on-chain account.
    pub fn settle_receipt<'info>(
        ctx: Context<'_, '_, '_, 'info, SettleReceipt<'info>>,
        receipt: receipt::JoinReceipt,
        proof: light_sdk::instruction::ValidityProof,
        address_tree_info: light_sdk::instruction::PackedAddressTreeInfo,
        output_tree_index: u8,
    ) -> Result<()> {
        instructions::handle_settle_receipt(
            ctx,
            receipt,
            proof,
            address_tree_info,
            output_tree_index,
        )
    }
}

/// Accounts for pool initialization
#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = keeper,
        space = 8 + DataPool::INIT_SPACE,
        seeds = [b"data_pool", request_hash.as_ref()],
        bump,
    )]
    pub pool: Account<'info, DataPool>,

    /// Escrow token account — owned by escrow_authority PDA
    #[account(
        init,
        payer = keeper,
        token::mint = usdc_mint,
        token::authority = escrow_authority,
        seeds = [b"escrow", request_hash.as_ref()],
        bump,
    )]
    pub escrow: Account<'info, TokenAccount>,

    /// PDA that will own the escrow
    #[account(
        seeds = [b"escrow_authority", pool.key().as_ref()],
        bump,
    )]
    pub escrow_authority: SystemAccount<'info>,

    #[account(mut)]
    pub keeper: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
