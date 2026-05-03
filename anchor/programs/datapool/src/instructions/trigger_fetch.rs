use anchor_lang::prelude::*;

use crate::error::DataPoolError;
use crate::state::DataPool;

#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct TriggerFetch<'info> {
    #[account(
        mut,
        seeds = [b"data_pool", request_hash.as_ref()],
        bump = pool.bump,
        constraint = pool.fetched_at == 0 @ DataPoolError::AlreadyFetched,
        constraint = pool.keeper == keeper.key() @ DataPoolError::UnauthorizedFetch,
    )]
    pub pool: Account<'info, DataPool>,

    /// Off-chain keeper authorized to trigger fetches
    pub keeper: Signer<'info>,
}

pub fn handle_trigger_fetch(
    ctx: Context<TriggerFetch>,
    _request_hash: [u8; 32],
    data_hash: [u8; 32],
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        pool.buyer_count >= pool.min_buyers,
        DataPoolError::ThresholdNotReached
    );

    let now = Clock::get()?.unix_timestamp;
    pool.fetched_at = now;
    pool.data_hash = data_hash;

    msg!(
        "Pool {} fetched at {}. Data hash: {:?}",
        pool.key(),
        now,    
        data_hash
    );

    Ok(())
}
