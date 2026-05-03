use anchor_lang::prelude::*;

use crate::error::DataPoolError;
use crate::state::DataPool;

/// Called by the keeper after fetching to make the pool open for
/// post-fetch buyers (time-decay pricing begins now).
#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct RegisterDataset<'info> {
    #[account(
        mut,
        seeds = [b"data_pool", request_hash.as_ref()],
        bump = pool.bump,
        constraint = pool.fetched_at != 0 @ DataPoolError::NotFetchedYet,
        constraint = pool.keeper == keeper.key() @ DataPoolError::UnauthorizedFetch,
    )]
    pub pool: Account<'info, DataPool>,

    pub keeper: Signer<'info>,
}

pub fn handle_register_dataset(
    ctx: Context<RegisterDataset>,
    _request_hash: [u8; 32],
    // IPFS CID or off-chain storage reference (logged, not stored on-chain to save space)
    storage_ref: String,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Re-open pool for post-fetch buyers at decayed price
    pool.is_open = true;

    msg!(
        "Dataset registered for pool {}. Storage ref: {}. Decay starts from {}.",
        pool.key(),
        storage_ref,
        pool.fetched_at
    );

    Ok(())
}
