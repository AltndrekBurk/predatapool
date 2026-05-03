use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::DataPoolError;
use crate::state::{BuyerSlot, DataPool};

/// Sponsors (pre-fetch buyers) claim retroactive rebates from post-fetch revenue.
/// Rebate = (sponsor_paid / total_sponsor_paid) * POST_FETCH_REVENUE * REBATE_SHARE_BPS / 10000
/// REBATE_SHARE_BPS = 3000 (30% of post-fetch revenue goes to sponsors)
const REBATE_SHARE_BPS: u64 = 3000;

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

    #[account(
        mut,
        seeds = [b"buyer_slot", pool.key().as_ref(), buyer.key().as_ref()],
        bump = buyer_slot.bump,
        constraint = buyer_slot.is_sponsor @ DataPoolError::NoRebateToClaim,
        constraint = !buyer_slot.rebate_claimed @ DataPoolError::NoRebateToClaim,
        constraint = buyer_slot.buyer == buyer.key(),
    )]
    pub buyer_slot: Account<'info, BuyerSlot>,

    /// Pool escrow (PDA-owned) — source of rebate funds
    #[account(
        mut,
        address = pool.escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Sponsor's USDC token account — receives rebate
    #[account(mut)]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// PDA that owns the escrow
    /// Seeds: ["escrow_authority", pool_pubkey]
    #[account(
        seeds = [b"escrow_authority", pool.key().as_ref()],
        bump,
    )]
    pub escrow_authority: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_rebate(ctx: Context<ClaimRebate>, request_hash: [u8; 32]) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let slot = &mut ctx.accounts.buyer_slot;

    // Calculate post-fetch revenue
    // Pre-fetch sponsors paid base_price; post-fetch buyers pay decayed price.
    // We approximate: post_fetch_revenue = total_collected - (sponsor_count * base_price)
    // Simplified for MVP: use stored total_collected minus estimated pre-fetch portion.
    let pre_fetch_collected = (pool.base_price_usdc as u128)
        .checked_mul(pool.buyer_count as u128)
        .unwrap_or(0);
    let total = pool.total_collected as u128;
    let post_fetch_revenue = total.saturating_sub(pre_fetch_collected) as u64;

    // Sponsor's proportional share = amount_paid / total_collected (simplified)
    let sponsor_share_num = slot.amount_paid as u128;
    let sponsor_share_den = pool.total_collected.max(1) as u128;

    let rebate_amount = (post_fetch_revenue as u128)
        .saturating_mul(REBATE_SHARE_BPS as u128)
        .saturating_div(10000)
        .saturating_mul(sponsor_share_num)
        .saturating_div(sponsor_share_den) as u64;

    require!(rebate_amount > 0, DataPoolError::NoRebateToClaim);

    // Invariant check: ensure we don't over-distribute
    let new_distributed = pool
        .total_distributed
        .checked_add(rebate_amount)
        .ok_or(DataPoolError::Overflow)?;
    require!(
        new_distributed <= pool.total_collected,
        DataPoolError::Overflow
    );

    // Transfer rebate from escrow to sponsor
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

    // Mark as claimed and update pool accounting
    slot.rebate_claimed = true;
    slot.rebate_amount = rebate_amount;

    let pool_mut = &mut ctx.accounts.pool;
    pool_mut.total_distributed = new_distributed;

    msg!(
        "Rebate claimed: {} USDC micro-units to sponsor {}",
        rebate_amount,
        ctx.accounts.buyer.key()
    );

    Ok(())
}
