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

    // Threshold enforcement lives off-chain in the matcher (server/src/matcher.ts
    // `shouldTriggerFetch`). The keeper-only constraint above is the security
    // boundary; the redundant on-chain count would create a chicken-and-egg
    // problem because `buyer_count` is bumped only by `settle_receipt`, which
    // buyers can only sign AFTER trigger_fetch records `data_hash`.

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
