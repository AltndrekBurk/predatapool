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
}
