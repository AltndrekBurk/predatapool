use anchor_lang::prelude::*;

#[error_code]
pub enum DataPoolError {
    #[msg("Pool is already closed for new members")]
    PoolClosed,
    #[msg("Pool has already been fetched")]
    AlreadyFetched,
    #[msg("Insufficient payment amount")]
    InsufficientPayment,
    #[msg("Caller is not authorized to trigger fetch")]
    UnauthorizedFetch,
    #[msg("No rebate available to claim")]
    NoRebateToClaim,
    #[msg("Pool has not been fetched yet")]
    NotFetchedYet,
    #[msg("Buyer already joined this pool")]
    AlreadyJoined,
    #[msg("Pool threshold not yet reached")]
    ThresholdNotReached,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid decay rate: must be between 1 and 10000 basis points")]
    InvalidDecayRate,
    #[msg("Caller is not authorized to claim this revenue")]
    UnauthorizedClaim,
    #[msg("Invalid revenue split: provider_share + sponsor_share must be <= 10000 bps")]
    InvalidRevenueSplit,
    #[msg("Receipt deadline has passed")]
    ReceiptExpired,
    #[msg("Receipt max_price below current pool price")]
    ReceiptPriceTooLow,
    #[msg("Receipt pool_hash does not match this pool")]
    ReceiptPoolMismatch,
    #[msg("Ed25519 verify instruction missing or malformed")]
    EdVerifyMissing,
    #[msg("Ed25519 instruction does not authorize this receipt")]
    EdVerifyMismatch,
    #[msg("Receipt domain prefix incorrect — wrong protocol or version")]
    ReceiptBadDomain,
    #[msg("Storage URI exceeds the on-chain length cap")]
    StorageUriTooLong,
}
