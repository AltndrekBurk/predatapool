use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::DataPoolError;
use crate::state::{BuyerSlot, DataPool};

#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct JoinPool<'info> {
    #[account(
        mut,
        seeds = [b"data_pool", request_hash.as_ref()],
        bump = pool.bump,
        constraint = pool.is_open @ DataPoolError::PoolClosed,
    )]
    pub pool: Account<'info, DataPool>,

    /// Buyer's slot — created on first join, rejected if already exists
    #[account(
        init,
        payer = buyer,
        space = 8 + BuyerSlot::INIT_SPACE,
        seeds = [b"buyer_slot", pool.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub buyer_slot: Account<'info, BuyerSlot>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Buyer's USDC token account
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// Pool escrow — PDA-owned token account
    #[account(
        mut,
        address = pool.escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_join_pool(ctx: Context<JoinPool>, _request_hash: [u8; 32]) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let now = Clock::get()?.unix_timestamp;

    // Calculate price based on current time-decay
    let price = pool.current_price(now);

    require!(
        ctx.accounts.buyer_token_account.amount >= price,
        DataPoolError::InsufficientPayment
    );

    // Transfer USDC from buyer to escrow
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, price)?;

    // Record buyer slot
    let slot = &mut ctx.accounts.buyer_slot;
    slot.pool = pool.key();
    slot.buyer = ctx.accounts.buyer.key();
    slot.amount_paid = price;
    slot.joined_at = now;
    slot.is_sponsor = pool.fetched_at == 0; // sponsor = joined before fetch
    slot.rebate_claimed = false;
    slot.rebate_amount = 0;
    slot.bump = ctx.bumps.buyer_slot;

    // Update pool totals
    pool.total_collected = pool
        .total_collected
        .checked_add(price)
        .ok_or(DataPoolError::Overflow)?;
    pool.buyer_count = pool.buyer_count.saturating_add(1);

    msg!(
        "Buyer {} joined pool. Price: {} USDC micro-units. Sponsor: {}",
        ctx.accounts.buyer.key(),
        price,
        slot.is_sponsor
    );

    Ok(())
}
