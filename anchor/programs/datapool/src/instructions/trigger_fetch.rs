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
        constraint = pool.fetched_at_ms == 0 @ DataPoolError::AlreadyFetched,
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

    let now_secs = Clock::get()?.unix_timestamp;
    pool.fetched_at_ms = now_secs.saturating_mul(1000);
    pool.data_hash = data_hash;

    msg!(
        "Pool {} fetched at {} ms. Data hash: {:?}",
        pool.key(),
        pool.fetched_at_ms,
        data_hash
    );

    Ok(())
}
