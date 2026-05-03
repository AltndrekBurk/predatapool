use anchor_lang::prelude::*;

/// A pending or completed data pool.
/// Seeds: ["data_pool", request_hash]
#[account]
#[derive(InitSpace)]
pub struct DataPool {
    /// SHA-256 hash of the canonical data request (endpoint + params)
    pub request_hash: [u8; 32],

    /// Authority that can trigger the fetch (off-chain keeper pubkey)
    pub keeper: Pubkey,

    /// USDC mint address
    pub usdc_mint: Pubkey,

    /// Pool escrow token account (PDA-owned)
    pub escrow: Pubkey,

    /// Base price in USDC micro-units (6 decimals) to access this dataset
    pub base_price_usdc: u64,

    /// Minimum number of buyers before fetch can be triggered
    pub min_buyers: u8,

    /// Current number of buyers who have joined
    pub buyer_count: u8,

    /// Total USDC collected in escrow
    pub total_collected: u64,

    /// Total USDC distributed as rebates (invariant: distributed <= collected)
    pub total_distributed: u64,

    /// Timestamp when the data was fetched (0 = not yet fetched)
    pub fetched_at: i64,

    /// SHA-256 hash of the fetched data payload (set after fetch)
    pub data_hash: [u8; 32],

    /// Time-decay rate in basis points per hour (100 = 1% per hour)
    /// Price formula: base_price * max(0, 10000 - decay_bps * hours_elapsed) / 10000
    pub decay_bps_per_hour: u16,

    /// Whether the pool is accepting new buyers
    pub is_open: bool,

    /// Bump for PDA derivation
    pub bump: u8,
}

impl DataPool {
    /// Calculate current price based on time elapsed since fetch.
    /// Returns base_price_usdc if not yet fetched (pre-fetch = full price).
    pub fn current_price(&self, now: i64) -> u64 {
        if self.fetched_at == 0 {
            return self.base_price_usdc;
        }
        let hours_elapsed = ((now - self.fetched_at) as u64).saturating_div(3600);
        let decay = (self.decay_bps_per_hour as u64)
            .saturating_mul(hours_elapsed)
            .min(10000);
        self.base_price_usdc
            .saturating_mul(10000u64.saturating_sub(decay))
            .saturating_div(10000)
            .max(1) // floor: 1 micro-USDC minimum
    }
}

/// One buyer's slot in a DataPool.
/// Seeds: ["buyer_slot", pool_pubkey, buyer_pubkey]
#[account]
#[derive(InitSpace)]
pub struct BuyerSlot {
    pub pool: Pubkey,
    pub buyer: Pubkey,

    /// Amount paid in USDC micro-units
    pub amount_paid: u64,

    /// Unix timestamp of join
    pub joined_at: i64,

    /// Whether this was a pre-fetch sponsor (joined before fetched_at was set)
    pub is_sponsor: bool,

    /// Whether rebate has been claimed
    pub rebate_claimed: bool,

    /// Rebate amount available (set after enough post-fetch buyers have joined)
    pub rebate_amount: u64,

    pub bump: u8,
}
