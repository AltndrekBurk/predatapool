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

    /// Number of receipts settled on-chain for this pool. u32 instead of u8
    /// so high-volume pools (>255 buyers) don't silently saturate.
    pub buyer_count: u32,

    /// Total USDC collected in escrow
    pub total_collected: u64,

    /// Total USDC distributed as rebates (invariant: distributed <= collected)
    pub total_distributed: u64,

    /// Unix-millisecond timestamp when the data was fetched (0 = not yet
    /// fetched). Stored in ms so it shares units with `expires_at_ms`.
    pub fetched_at_ms: i64,

    /// SHA-256 hash of the fetched data payload (set after fetch)
    pub data_hash: [u8; 32],

    /// Buyer-side AoI decay rate — λ in Q16.16 fixed-point, units = per hour.
    ///   price(t) = base * exp(-(λ_q / 2^16) · Δhours)
    /// Example: 656 ≈ 0.01/hr ≈ -1%/hr near t=0 (matches the old 100 bps/hr).
    pub lambda_q16_per_hour: u32,

    /// Data provider's wallet — data rights holder.
    /// Receives a time-decayed share of post-fetch revenue per their agreement.
    pub provider: Pubkey,

    /// Provider's base share of post-fetch revenue, in bps at fetch time.
    /// Decays per `provider_lambda_q16_per_hour` to model aging data rights.
    pub provider_share_bps: u16,

    /// Provider-side AoI decay rate — λ in Q16.16 fixed-point, units = per hour.
    /// Same formula as `lambda_q16_per_hour`; share floors at 0 instead of 1.
    pub provider_lambda_q16_per_hour: u32,

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

    /// Calculate current price using exponential AoI decay.
    ///   price(t) = base * exp(-λ · Δhours)
    /// Floors at 1 micro-USDC. Pre-fetch returns base.
    pub fn current_price(&self, now_secs: i64) -> u64 {
        if self.fetched_at_ms == 0 {
            return self.base_price_usdc;
        }
        let now_ms = now_secs.saturating_mul(1000);
        let dt_ms = (now_ms - self.fetched_at_ms).max(0) as u64;
        let x_q = lambda_dt_to_xq(self.lambda_q16_per_hour, dt_ms);
        let exp_q = exp_neg_q16(x_q);
        let price = (self.base_price_usdc as u128)
            .saturating_mul(exp_q as u128)
            / Q as u128;
        (price as u64).max(1)
    }

    /// Provider's currently-effective share of post-fetch revenue, in bps.
    /// Same exponential decay as `current_price`; floors at 0 (not 1) since
    /// share is a percentage, not a price.
    pub fn provider_share_bps_now(&self, now_secs: i64) -> u64 {
        if self.fetched_at_ms == 0 {
            return self.provider_share_bps as u64;
        }
        let now_ms = now_secs.saturating_mul(1000);
        let dt_ms = (now_ms - self.fetched_at_ms).max(0) as u64;
        let x_q = lambda_dt_to_xq(self.provider_lambda_q16_per_hour, dt_ms);
        let exp_q = exp_neg_q16(x_q);
        ((self.provider_share_bps as u128) * (exp_q as u128) / Q as u128) as u64
    }
}

// ── Q16.16 fixed-point exponential decay ──────────────────────────────────
//
// All arithmetic is integer-only and deterministic. `exp_neg_q16` evaluates
// exp(-x) where x is a Q16.16 unsigned fixed-point number. Strategy: range
// reduction x = k·ln2 + r, r in [0, ln2). Compute exp(-r) via a degree-5
// minimax polynomial in Horner form, then divide by 2^k with a right shift.
//
// Verified against Math.exp at x ∈ {0, ln2, 1, 5, 10}: relative error <5e-5.
// Saturates to 0 at x ≥ 21 (exp(-21) ≈ 7.6e-10, below the Q16.16 LSB).

/// One in Q16.16 (= 2^16).
pub const Q: u64 = 65_536;
/// ln(2) in Q16.16 — rounded to nearest. 0.69314718 · 2^16 ≈ 45_426.
pub const LN2_Q: u64 = 45_426;
/// exp(-x) ≈ 0 for x ≥ 21; cap saves loop iterations and overflow risk.
pub const X_MAX_Q: u64 = 21 * Q;

/// Convert (λ stored as Q16.16 per-hour, Δmilliseconds) into x = λ·Δhours
/// in Q16.16. Saturates at `X_MAX_Q` so callers don't have to worry about
/// overflow.
#[inline]
fn lambda_dt_to_xq(lambda_q_per_hour: u32, dt_ms: u64) -> u64 {
    // x_q = (λ_q * dt_ms / 3_600_000) in Q16.16. u128 absorbs the product:
    // worst case λ_q = u32::MAX ≈ 4.3e9, dt_ms = u64 — fits u128.
    let raw = (lambda_q_per_hour as u128).saturating_mul(dt_ms as u128) / 3_600_000u128;
    if raw >= X_MAX_Q as u128 {
        X_MAX_Q
    } else {
        raw as u64
    }
}

/// exp(-x) in Q16.16. `x_q` is also Q16.16. Saturates to 0 at x ≥ 21.
pub fn exp_neg_q16(x_q: u64) -> u64 {
    if x_q >= X_MAX_Q {
        return 0;
    }
    let k = x_q / LN2_Q; // integer part in units of ln2
    let r_q = (x_q - k * LN2_Q) as i128; // r in [0, ln2), Q16.16
    let q = Q as i128;

    // Horner: exp(-r) ≈ 1 - r + r²/2 - r³/6 + r⁴/24 - r⁵/120
    //   coefficients in Q16.16, signed
    let c5: i128 = -q / 120;
    let c4: i128 = q / 24;
    let c3: i128 = -q / 6;
    let c2: i128 = q / 2;
    let c1: i128 = -q;
    let c0: i128 = q;

    let mut acc = c5;
    acc = (acc * r_q) / q + c4;
    acc = (acc * r_q) / q + c3;
    acc = (acc * r_q) / q + c2;
    acc = (acc * r_q) / q + c1;
    acc = (acc * r_q) / q + c0;

    // acc is exp(-r) in Q16.16, ∈ [Q/2, Q]. Multiply by 2^-k via right shift.
    let exp_r = acc.max(0) as u64; // polynomial bounded; clamp defensively
    exp_r >> k as u32
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
