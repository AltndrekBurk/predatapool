use anchor_lang::prelude::*;

use crate::error::DataPoolError;
use crate::state::DataPool;

/// Called by the keeper after fetching to make the pool open for post-fetch
/// buyers (time-decay pricing begins now) AND to publish the storage URI
/// where the raw payload can be pulled. Buyers verify SHA-256 of the
/// fetched bytes against `data_hash` before signing a settle receipt.
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
    storage_uri: String,
    key_commitment: [u8; 32],
    source_hash: [u8; 32],
    expires_at_ms: i64,
    merkle_root: [u8; 32],
    keeper_signature: [u8; 64],
) -> Result<()> {
    require!(
        storage_uri.len() <= DataPool::STORAGE_URI_MAX_LEN,
        DataPoolError::StorageUriTooLong
    );
    // Non-replayable: once `storage_uri` is populated, the dataset is bound to
    // the keeper's first registration. A second call would silently overwrite
    // key_commitment / merkle_root / storage_uri behind buyers who already
    // signed receipts against the original envelope.
    require!(
        ctx.accounts.pool.storage_uri.is_empty(),
        DataPoolError::AlreadyRegistered
    );

    let pool = &mut ctx.accounts.pool;

    pool.storage_uri = storage_uri;
    pool.key_commitment = key_commitment;
    pool.source_hash = source_hash;
    pool.expires_at_ms = expires_at_ms;
    pool.merkle_root = merkle_root;
    pool.keeper_signature = keeper_signature;

    msg!(
        "Dataset registered for pool {}. storage_uri: {}. fetched_at: {}.",
        pool.key(),
        pool.storage_uri,
        pool.fetched_at
    );

    Ok(())
}
