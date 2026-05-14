use anchor_lang::prelude::*;

// `LightDiscriminator` is re-exported by light_sdk both as a derive macro
// (from light_sdk_macros) and as a trait alias for
// light_account_checks::Discriminator. Bringing the derive into scope via
// a `use` statement avoids the path-resolution ambiguity that otherwise
// resolves the qualified path to the trait alias.
use light_sdk::LightDiscriminator;

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

    /// Data provider's wallet — data rights holder.
    /// Receives a time-decayed share of post-fetch revenue per their agreement.
    pub provider: Pubkey,

    /// Provider's base share of post-fetch revenue, in bps at fetch time.
    /// Decays per `provider_decay_bps_per_hour` to model aging data rights.
    pub provider_share_bps: u16,

    /// Time-decay rate for provider's share, in bps per hour.
    /// effective_bps(t) = provider_share_bps * max(0, 10000 - provider_decay * hrs) / 10000
    pub provider_decay_bps_per_hour: u16,

    /// Cumulative USDC paid to provider so far (for incremental claim accounting).
    pub provider_paid: u64,

    /// USDC collected from PRE-FETCH buyers (sponsors). Incremented in
    /// `settle_receipt` only when `is_sponsor == true` (i.e. pool not yet
    /// fetched). `claim_rebate` reads this directly to compute
    /// `post_fetch_revenue = total_collected - pre_fetch_collected`.
    ///
    /// Without this dedicated field the rebate calculation degenerates to
    /// zero: deriving pre-fetch revenue as `base_price * buyer_count`
    /// over-counts because `buyer_count` lumps pre- and post-fetch joins.
    pub pre_fetch_collected: u64,

    /// Where to fetch the raw payload bytes — IPFS CID or HTTP(S) URL.
    /// Buyers pull the bytes, hash locally with SHA-256, and compare with
    /// `data_hash` before signing a settle receipt. Capped at 128 chars so a
    /// CIDv1 (~62) or a short HTTPS URL fits with margin.
    #[max_len(128)]
    pub storage_uri: String,

    /// SHA-256("DATAPOOL_K_V1" || K_pool) published by the keeper in
    /// `register_dataset`. Buyers verify the K_pool they unwrap from the
    /// server against this before decrypting the payload — ensures the keeper
    /// can't silently deliver different keys to different buyers.
    pub key_commitment: [u8; 32],

    /// SHA-256(source_url). The raw source URL stays off-chain so user-facing
    /// metadata can evolve without reallocating this account.
    pub source_hash: [u8; 32],

    /// Unix millisecond expiry for the cached envelope. Buyers must reject
    /// payloads after this point even if the payload endpoint still responds.
    pub expires_at_ms: i64,

    /// DataEnvelope v0 root:
    /// SHA256(payload || source_url || fetched_at_ms || expires_at_ms).
    pub merkle_root: [u8; 32],

    /// Keeper Ed25519 signature over `merkle_root`. This is not a provider
    /// signature; it proves which keeper registered the envelope.
    pub keeper_signature: [u8; 64],

    /// Bump for PDA derivation
    pub bump: u8,
}

impl DataPool {
    /// Hard cap matching the `#[max_len]` on `storage_uri`. Kept in sync by
    /// hand — tests assert equality against the field's serialization.
    pub const STORAGE_URI_MAX_LEN: usize = 128;

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

    /// Provider's currently-effective share of post-fetch revenue, in bps.
    /// Decays from `provider_share_bps` toward 0 as data ages — provider's
    /// own time-based agreement. Floors at 0 (unlike buyer price which floors at 1).
    pub fn provider_share_bps_now(&self, now: i64) -> u64 {
        if self.fetched_at == 0 {
            return self.provider_share_bps as u64;
        }
        let hours_elapsed = ((now - self.fetched_at) as u64).saturating_div(3600);
        let decay = (self.provider_decay_bps_per_hour as u64)
            .saturating_mul(hours_elapsed)
            .min(10000);
        (self.provider_share_bps as u64)
            .saturating_mul(10000u64.saturating_sub(decay))
            .saturating_div(10000)
    }
}

/// One buyer's slot stored as a compressed leaf in Light Protocol's state
/// Merkle tree. Same logical fields as `BuyerSlot` minus the bump (no PDA
/// — the leaf address is derived from `["buyer_slot", pool, buyer]` via
/// Light's address tree).
///
/// Why compressed: at ~0.002 SOL of rent per BuyerSlot, a pool with 10k
/// buyers would cost the keeper 20 SOL just for slot accounts. With Light
/// compression, the slot contributes only a leaf-hash to a shared state
/// Merkle tree — no per-leaf rent — so onboarding cost stays roughly flat
/// regardless of buyer count. This is the buyer-side analogue of x402's
/// "fetch-once-share-N-ways" energy savings.
#[derive(
    Clone,
    Debug,
    Default,
    AnchorSerialize,
    AnchorDeserialize,
    LightDiscriminator,
)]
pub struct CompressedBuyerSlot {
    pub pool: Pubkey,
    pub buyer: Pubkey,
    pub amount_paid: u64,
    pub joined_at: i64,
    pub is_sponsor: bool,
    pub rebate_claimed: bool,
    pub rebate_amount: u64,
    /// Receipt nonce that produced this slot — replay protection.
    pub nonce: u64,
}
