use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[cfg(test)]
mod tests;

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;
use state::{BuyerSlot, DataPool};

declare_id!("62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D");

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
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            decay_bps_per_hour > 0 && decay_bps_per_hour <= 10000,
            error::DataPoolError::InvalidDecayRate
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
        pool.bump = ctx.bumps.pool;

        msg!("DataPool initialized. Request hash: {:?}", request_hash);
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
        storage_ref: String,
    ) -> Result<()> {
        instructions::handle_register_dataset(ctx, request_hash, storage_ref)
    }

    /// Early sponsor claims retroactive rebate from post-fetch buyer revenue.
    pub fn claim_rebate(ctx: Context<ClaimRebate>, request_hash: [u8; 32]) -> Result<()> {
        instructions::handle_claim_rebate(ctx, request_hash)
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
