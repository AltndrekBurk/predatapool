use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::DataPoolError;
use crate::state::DataPool;

/// Provider claims their time-decayed share of post-fetch revenue.
///
/// Economic model:
/// - Provider owns the data rights, so they earn on every post-fetch access
///   (not just the initial x402 fetch).
/// - Their share decays per their own agreement (`provider_decay_bps_per_hour`)
///   reflecting that data value erodes with age.
/// - Claim is incremental: provider can call repeatedly as new buyers join,
///   and only the marginal entitlement is paid out each time.
#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct ClaimProviderRevenue<'info> {
    #[account(
        mut,
        seeds = [b"data_pool", request_hash.as_ref()],
        bump = pool.bump,
        constraint = pool.fetched_at_ms != 0 @ DataPoolError::NotFetchedYet,
        constraint = pool.provider == provider.key() @ DataPoolError::UnauthorizedClaim,
    )]
    pub pool: Account<'info, DataPool>,

    /// Pool escrow (PDA-owned) — source of provider revenue.
    #[account(
        mut,
        address = pool.escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Provider's USDC token account — receives revenue.
    #[account(
        mut,
        token::mint = pool.usdc_mint,
        token::authority = provider,
    )]
    pub provider_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub provider: Signer<'info>,

    /// PDA that owns the escrow.
    /// Seeds: ["escrow_authority", pool_pubkey]
    #[account(
        seeds = [b"escrow_authority", pool.key().as_ref()],
        bump,
    )]
    pub escrow_authority: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_provider_revenue(
    ctx: Context<ClaimProviderRevenue>,
    _request_hash: [u8; 32],
) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let now = Clock::get()?.unix_timestamp;

    // Post-fetch revenue = everything collected minus what sponsors paid in.
    // `pre_fetch_collected` is maintained by settle_receipt for exactly this
    // purpose (claim_rebate uses the same field). Deriving via
    // `base_price * buyer_count` over-counts because buyer_count lumps
    // pre- and post-fetch joins together.
    let post_fetch_revenue = pool
        .total_collected
        .saturating_sub(pool.pre_fetch_collected);

    // Provider's currently-effective share, decayed by hours-since-fetch.
    let share_bps = pool.provider_share_bps_now(now);

    // Cumulative entitlement = post_fetch_revenue * effective_share_bps / 10000.
    let entitlement = (post_fetch_revenue as u128)
        .saturating_mul(share_bps as u128)
        .saturating_div(10000) as u64;

    // Marginal claim = total entitlement minus what's already been paid.
    let claim_amount = entitlement.saturating_sub(pool.provider_paid);

    require!(claim_amount > 0, DataPoolError::NoRebateToClaim);

    // Shared invariant: total_distributed (sponsors + provider) <= total_collected.
    let new_distributed = pool
        .total_distributed
        .checked_add(claim_amount)
        .ok_or(DataPoolError::Overflow)?;
    require!(
        new_distributed <= pool.total_collected,
        DataPoolError::Overflow
    );

    // Transfer from escrow to provider.
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
            to: ctx.accounts.provider_token_account.to_account_info(),
            authority: ctx.accounts.escrow_authority.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(cpi_ctx, claim_amount)?;

    let pool_mut = &mut ctx.accounts.pool;
    pool_mut.provider_paid = pool_mut
        .provider_paid
        .checked_add(claim_amount)
        .ok_or(DataPoolError::Overflow)?;
    pool_mut.total_distributed = new_distributed;

    msg!(
        "Provider revenue: {} USDC micro-units. Cumulative: {}. Effective share: {} bps",
        claim_amount,
        pool_mut.provider_paid,
        share_bps
    );

    Ok(())
}
