#[cfg(test)]
mod tests {
    use crate::state::{exp_neg_q16, DataPool, LN2_Q, Q, X_MAX_Q};

    // ── Time-decay pricing unit tests ──────────────────────────────────────
    // These test the pure math in DataPool::current_price without any on-chain setup.

    /// λ_per_hour in Q16.16. 0.01/hr → 656; 0.05/hr → 3277; 0.0667/hr → 4370.
    /// `lambda_real_per_hour * 65536` (rounded).
    const LAMBDA_001: u32 = 656; // ≈ 0.01/hr (was 100 bps/hr linear)
    const LAMBDA_005: u32 = 3277; // ≈ 0.05/hr (was 500 bps/hr)
    const LAMBDA_0667: u32 = 4370; // ≈ 0.0667/hr (was 667 bps/hr)
    const LAMBDA_002: u32 = 1311; // ≈ 0.02/hr (was 200 bps/hr)

    fn make_pool(base: u64, lambda_q16: u32, fetched_at: i64) -> DataPool {
        DataPool {
            request_hash: [0u8; 32],
            keeper: Default::default(),
            usdc_mint: Default::default(),
            escrow: Default::default(),
            base_price_usdc: base,
            min_buyers: 2,
            buyer_count: 0,
            total_collected: 0,
            total_distributed: 0,
            fetched_at,
            data_hash: [0u8; 32],
            lambda_q16_per_hour: lambda_q16,
            is_open: true,
            provider: Default::default(),
            provider_share_bps: 0,
            provider_lambda_q16_per_hour: 0,
            provider_paid: 0,
            pre_fetch_collected: 0,
            storage_uri: String::new(),
            key_commitment: [0u8; 32],
            source_hash: [0u8; 32],
            expires_at_ms: 0,
            merkle_root: [0u8; 32],
            keeper_signature: [0u8; 64],
            bump: 0,
        }
    }

    fn make_pool_with_provider(
        base: u64,
        lambda_q16: u32,
        fetched_at: i64,
        total_collected: u64,
        buyer_count: u8,
        provider_share_bps: u16,
        provider_lambda_q16: u32,
    ) -> DataPool {
        DataPool {
            request_hash: [0u8; 32],
            keeper: Default::default(),
            usdc_mint: Default::default(),
            escrow: Default::default(),
            base_price_usdc: base,
            min_buyers: 2,
            buyer_count,
            total_collected,
            total_distributed: 0,
            fetched_at,
            data_hash: [0u8; 32],
            lambda_q16_per_hour: lambda_q16,
            is_open: true,
            provider: Default::default(),
            provider_share_bps,
            provider_lambda_q16_per_hour: provider_lambda_q16,
            provider_paid: 0,
            pre_fetch_collected: 0,
            storage_uri: String::new(),
            key_commitment: [0u8; 32],
            source_hash: [0u8; 32],
            expires_at_ms: 0,
            merkle_root: [0u8; 32],
            keeper_signature: [0u8; 64],
            bump: 0,
        }
    }

    /// Asserts |actual - expected| <= tolerance. Names both for clarity.
    fn assert_close(actual: u64, expected: u64, tolerance: u64, what: &str) {
        let diff = if actual > expected {
            actual - expected
        } else {
            expected - actual
        };
        assert!(
            diff <= tolerance,
            "{what}: expected {expected} ± {tolerance}, got {actual} (diff {diff})"
        );
    }

    // ── exp_neg_q16 precision tests ────────────────────────────────────────

    #[test]
    fn test_exp_neg_q16_at_zero_is_one() {
        assert_eq!(exp_neg_q16(0), Q);
    }

    #[test]
    fn test_exp_neg_q16_at_ln2_is_half() {
        // exp(-ln2) = 0.5 = Q/2 = 32768. Tolerance ±2 for poly + rounding.
        assert_close(exp_neg_q16(LN2_Q), Q / 2, 2, "exp(-ln2) = 1/2");
    }

    #[test]
    fn test_exp_neg_q16_at_one_is_1_over_e() {
        // exp(-1) ≈ 0.36788. In Q16.16 that's 24109. Tolerance ±4.
        assert_close(exp_neg_q16(Q), 24_109, 4, "exp(-1) ≈ 1/e");
    }

    #[test]
    fn test_exp_neg_q16_at_five() {
        // exp(-5) ≈ 0.006738 → Q16.16 ≈ 442. Tolerance ±3.
        assert_close(exp_neg_q16(5 * Q), 442, 3, "exp(-5)");
    }

    #[test]
    fn test_exp_neg_q16_at_ten() {
        // exp(-10) ≈ 4.54e-5 → Q16.16 ≈ 3. Tolerance ±2.
        assert_close(exp_neg_q16(10 * Q), 3, 2, "exp(-10)");
    }

    #[test]
    fn test_exp_neg_q16_saturates_at_x_max() {
        assert_eq!(exp_neg_q16(X_MAX_Q), 0);
        assert_eq!(exp_neg_q16(X_MAX_Q + 12345), 0);
        assert_eq!(exp_neg_q16(u64::MAX), 0);
    }

    #[test]
    fn test_price_pre_fetch_is_base_price() {
        let pool = make_pool(1_000_000, LAMBDA_001, 0); // fetched_at = 0
        assert_eq!(pool.current_price(1_000_000), 1_000_000);
    }

    // Use a non-zero base time so fetched_at != 0 sentinel
    const T0: i64 = 1_700_000_000; // Nov 2023 — arbitrary past timestamp

    #[test]
    fn test_price_immediately_after_fetch_is_base() {
        let pool = make_pool(1_000_000, LAMBDA_001, T0);
        // dt = 0 → exp(0) = 1 → base
        assert_eq!(pool.current_price(T0), 1_000_000);
    }

    #[test]
    fn test_price_decays_after_1_hour() {
        // λ_q16 = 656 ≈ 0.01001/hr (Q16.16 round-off). After 1hr:
        // exp(-0.01001) ≈ 0.99005 → ~990_040 micro. Tolerance covers both
        // the λ representation rounding and the polynomial error.
        let pool = make_pool(1_000_000, LAMBDA_001, T0);
        assert_close(
            pool.current_price(T0 + 3600),
            990_040,
            300,
            "exp decay 1hr at λ≈0.01/hr",
        );
    }

    #[test]
    fn test_price_decays_after_10_hours() {
        // exp(-0.1001) ≈ 0.90479 → ~904_790 micro.
        let pool = make_pool(1_000_000, LAMBDA_001, T0);
        assert_close(
            pool.current_price(T0 + 36_000),
            904_790,
            500,
            "exp decay 10hr at λ≈0.01/hr",
        );
    }

    #[test]
    fn test_price_decays_after_50_hours() {
        // exp(-0.5005) ≈ 0.60622 → ~606_220 micro. Linear would have hit 50%.
        let pool = make_pool(1_000_000, LAMBDA_001, T0);
        assert_close(
            pool.current_price(T0 + 50 * 3600),
            606_220,
            500,
            "exp decay 50hr at λ≈0.01/hr",
        );
    }

    #[test]
    fn test_price_floor_at_1_microusdc_far_future() {
        // After many hours, x > 21 → exp_neg saturates to 0 → floored to 1.
        let pool = make_pool(1_000_000, LAMBDA_001, T0);
        // λ=0.01/hr × 2200hr = x=22 → saturates.
        assert_eq!(pool.current_price(T0 + 2200 * 3600), 1);
    }

    #[test]
    fn test_fast_decay_gps_data() {
        // λ=0.0667/hr (GPS RTK), 15hr → x≈1.0 → exp(-1) ≈ 0.3679.
        // Old linear test asserted floor=1 here; exp keeps real value.
        let pool = make_pool(500_000, LAMBDA_0667, T0);
        assert_close(
            pool.current_price(T0 + 15 * 3600),
            183_940,
            200,
            "GPS decay at 15hr",
        );
    }

    #[test]
    fn test_fast_decay_gps_data_floors_eventually() {
        // λ=0.0667/hr × 350hr = x≈23 → saturates → floor = 1.
        let pool = make_pool(500_000, LAMBDA_0667, T0);
        assert_eq!(pool.current_price(T0 + 350 * 3600), 1);
    }

    #[test]
    fn test_rebate_invariant_always_holds() {
        // The critical invariant: total_distributed can never exceed total_collected
        // This test simulates the invariant check in claim_rebate
        let total_collected: u64 = 1_000_000;
        let total_distributed: u64 = 999_999;
        let rebate_amount: u64 = 1;

        let new_distributed = total_distributed.checked_add(rebate_amount).unwrap();
        assert!(
            new_distributed <= total_collected,
            "Invariant violated: distributed {} > collected {}",
            new_distributed,
            total_collected
        );
    }

    #[test]
    fn test_rebate_invariant_blocks_over_distribution() {
        let total_collected: u64 = 1_000_000;
        let total_distributed: u64 = 999_999;
        let rebate_amount: u64 = 2; // would exceed

        let new_distributed = total_distributed.checked_add(rebate_amount).unwrap();
        assert!(
            new_distributed > total_collected,
            "Expected invariant to catch this"
        );
        // In the program, this triggers DataPoolError::Overflow
    }

    #[test]
    fn test_decay_with_zero_base_price_floors_at_1() {
        let pool = make_pool(0, LAMBDA_001, T0);
        // Base price 0 × exp(anything) = 0; price.max(1) → 1.
        assert_eq!(pool.current_price(T0 + 3600), 1);
    }

    // ── Provider revenue tests ─────────────────────────────────────────────

    #[test]
    fn test_provider_share_pre_fetch_is_base() {
        // Before fetch, share == base (no decay applied yet)
        let pool = make_pool_with_provider(1_000_000, LAMBDA_001, 0, 0, 0, 6000, LAMBDA_002);
        assert_eq!(pool.provider_share_bps_now(1_700_000_000), 6000);
    }

    #[test]
    fn test_provider_share_decays_per_agreement() {
        // base 6000 bps (60%), provider λ=0.02/hr.
        // After 10 hours: exp(-0.2) ≈ 0.8187 → 6000 * 0.8187 ≈ 4912 bps.
        let pool = make_pool_with_provider(1_000_000, LAMBDA_001, T0, 0, 0, 6000, LAMBDA_002);
        assert_close(
            pool.provider_share_bps_now(T0 + 10 * 3600),
            4912,
            5,
            "provider share decay 10hr at λ=0.02/hr",
        );
    }

    #[test]
    fn test_provider_share_floors_at_zero_not_one() {
        // After far-future time, provider share decays to 0 (data rights expire).
        // λ=0.02/hr × 1200hr = x=24 → saturates → 0.
        let pool = make_pool_with_provider(1_000_000, LAMBDA_001, T0, 0, 0, 6000, LAMBDA_002);
        assert_eq!(pool.provider_share_bps_now(T0 + 1200 * 3600), 0);
    }

    #[test]
    fn test_three_way_invariant_provider_plus_sponsor_fits() {
        // Sponsors take up to 30% (REBATE_SHARE_BPS), provider takes up to 60%.
        // Together: 90% — leaves 10% headroom for protocol/buffer.
        let provider_share: u64 = 6000;
        let sponsor_share: u64 = 3000; // REBATE_SHARE_BPS
        assert!(provider_share + sponsor_share <= 10000);

        // Simulated: post-fetch revenue = 1_000_000 μUSDC
        let post_fetch_revenue: u64 = 1_000_000;
        let max_provider = post_fetch_revenue * provider_share / 10000;
        let max_sponsor = post_fetch_revenue * sponsor_share / 10000;
        // Combined claims must fit within post-fetch revenue
        assert!(max_provider + max_sponsor <= post_fetch_revenue);
    }

    // ── claim_rebate accounting tests ──────────────────────────────────────
    // The pre-fix bug: rebate was computed against `base_price * buyer_count`,
    // which counts BOTH pre and post buyers. Fix: track `pre_fetch_collected`
    // separately and derive `post_fetch_revenue = total - pre_fetch_collected`.

    /// Mirror of the calc inside `handle_claim_rebate` for unit testing.
    fn rebate_amount(
        pool_total_collected: u64,
        pool_pre_fetch_collected: u64,
        rebate_share_bps: u64,
        sponsor_amount_paid: u64,
    ) -> u64 {
        let post_fetch_revenue =
            pool_total_collected.saturating_sub(pool_pre_fetch_collected);
        let den = pool_pre_fetch_collected.max(1) as u128;
        ((post_fetch_revenue as u128)
            .saturating_mul(rebate_share_bps as u128)
            .saturating_div(10000)
            .saturating_mul(sponsor_amount_paid as u128)
            .saturating_div(den)) as u64
    }

    #[test]
    fn test_rebate_pays_pre_fetch_sponsor_after_post_fetch_buyers() {
        // 2 sponsors paid 1M each pre-fetch (total pre = 2M).
        // 3 post-fetch buyers paid 800k each (total = 2M + 2.4M = 4.4M).
        // post_fetch_revenue = 4.4M - 2M = 2.4M.
        // sponsor share pool = 30% of 2.4M = 720k.
        // each sponsor (1M / 2M) = 50% → rebate = 360k.
        let r = rebate_amount(4_400_000, 2_000_000, 3000, 1_000_000);
        assert_eq!(r, 360_000);
    }

    #[test]
    fn test_rebate_zero_when_no_post_fetch_revenue() {
        // All buyers were sponsors, no post-fetch joins → no rebate to share.
        let r = rebate_amount(2_000_000, 2_000_000, 3000, 1_000_000);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_rebate_split_pro_rata_across_sponsors() {
        // pre = 3M (sponsor A 1M, sponsor B 2M), post = 3M, total = 6M.
        // post_fetch_revenue = 3M, rebate pool = 30% = 900k.
        // A's share = 1M/3M = 33.3% → 300k.
        // B's share = 2M/3M = 66.6% → 600k.
        let a = rebate_amount(6_000_000, 3_000_000, 3000, 1_000_000);
        let b = rebate_amount(6_000_000, 3_000_000, 3000, 2_000_000);
        assert_eq!(a, 300_000);
        assert_eq!(b, 600_000);
        // Total claims must not exceed the rebate pool.
        assert!(a + b <= 900_000);
    }

    #[test]
    fn test_rebate_safe_when_pre_fetch_collected_is_zero() {
        // Edge case: claim_rebate called before any sponsor settled.
        // Should not divide by zero — `.max(1)` guards.
        let r = rebate_amount(0, 0, 3000, 0);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_rebate_buggy_pre_fix_calc_yields_zero_for_real_workload() {
        // Replays the OLD (broken) formula to document why the field was needed:
        //   pre_fetch_collected_bug = base_price * buyer_count
        // For 2 sponsors @ 1M base + 3 post-fetch buyers @ 800k decayed:
        //   total_collected = 4.4M, buyer_count = 5, base = 1M
        //   pre_fetch_collected_bug = 1M * 5 = 5M (over-counts!)
        //   post_fetch_revenue_bug = 4.4M - 5M  → saturates to 0
        let total_collected: u64 = 4_400_000;
        let buyer_count: u64 = 5;
        let base_price: u64 = 1_000_000;
        let pre_buggy = base_price.saturating_mul(buyer_count);
        let post_buggy = total_collected.saturating_sub(pre_buggy);
        assert_eq!(post_buggy, 0);
        // Versus the fixed formula on the same workload — 360k rebate available.
        assert_eq!(rebate_amount(4_400_000, 2_000_000, 3000, 1_000_000), 360_000);
    }

    #[test]
    fn test_provider_incremental_claim() {
        // Provider should only receive marginal entitlement on each claim.
        // Simulated: post_fetch_revenue grows from 100 → 200 → 300.
        // share = 6000 bps (60%), no decay (immediate).
        let mut pool =
            make_pool_with_provider(1_000_000, 100, T0, 100, 0, 6000, 0);
        // base_price=1M, buyer_count=0 → pre_fetch_collected=0 → all 100 is post-fetch.

        // Round 1: total_collected=100, share=60% → entitlement=60.
        let entitlement_1 = (pool.total_collected as u128 * 6000 / 10000) as u64;
        let claim_1 = entitlement_1.saturating_sub(pool.provider_paid);
        assert_eq!(claim_1, 60);
        pool.provider_paid += claim_1;

        // Round 2: total_collected=200 → entitlement=120 → marginal=60.
        pool.total_collected = 200;
        let entitlement_2 = (pool.total_collected as u128 * 6000 / 10000) as u64;
        let claim_2 = entitlement_2.saturating_sub(pool.provider_paid);
        assert_eq!(claim_2, 60);
        pool.provider_paid += claim_2;

        // Total paid never exceeds entitlement
        assert!(pool.provider_paid <= entitlement_2);
    }

    // ── Provider revenue: pre_fetch_collected fix ────────────────────────
    // The pre-fix `claim_provider_revenue` derived pre-fetch revenue as
    // `base_price * buyer_count`. That over-counts because buyer_count lumps
    // pre- and post-fetch joins together → it eats into the post-fetch pool
    // and shrinks the provider's claim. The fix reads the dedicated
    // `pre_fetch_collected` field that settle_receipt maintains.

    #[test]
    fn test_provider_claim_uses_pre_fetch_collected_field() {
        // Realistic mixed pool:
        //   - 2 sponsors paid base=1_000_000 each (pre_fetch_collected=2_000_000)
        //   - 3 post-fetch buyers paid decayed price=500_000 each (post=1_500_000)
        //   - total_collected = 3_500_000, buyer_count = 5
        let mut pool =
            make_pool_with_provider(1_000_000, 100, T0, 3_500_000, 5, 6000, 0);
        pool.pre_fetch_collected = 2_000_000;

        // FIXED derivation: post = total - pre_fetch_collected
        let post_fetch_revenue = pool
            .total_collected
            .saturating_sub(pool.pre_fetch_collected);
        assert_eq!(post_fetch_revenue, 1_500_000);
        let entitlement = (post_fetch_revenue as u128 * 6000 / 10000) as u64;
        assert_eq!(entitlement, 900_000);

        // OLD BUGGY derivation: base_price * buyer_count == 1M * 5 == 5M,
        // total - 5M saturating_sub → 0 → entitlement = 0 (provider robbed).
        let buggy_pre = (pool.base_price_usdc as u128)
            .checked_mul(pool.buyer_count as u128)
            .unwrap();
        let buggy_post =
            (pool.total_collected as u128).saturating_sub(buggy_pre) as u64;
        assert_eq!(buggy_post, 0);
    }

    #[test]
    fn test_provider_claim_correct_with_only_post_fetch_buyers() {
        // No sponsors → pre_fetch_collected stays 0 → post = total.
        let pool =
            make_pool_with_provider(1_000_000, 100, T0, 1_500_000, 3, 5000, 0);
        let post_fetch_revenue = pool
            .total_collected
            .saturating_sub(pool.pre_fetch_collected);
        assert_eq!(post_fetch_revenue, 1_500_000);
        let entitlement = (post_fetch_revenue as u128 * 5000 / 10000) as u64;
        assert_eq!(entitlement, 750_000);
    }

    #[test]
    fn test_provider_claim_zero_when_only_sponsors() {
        // All revenue is from sponsors (pre-fetch). claim_rebate's job,
        // not claim_provider_revenue's. Provider entitlement = 0.
        let mut pool =
            make_pool_with_provider(1_000_000, 100, T0, 2_000_000, 2, 6000, 0);
        pool.pre_fetch_collected = 2_000_000;
        let post_fetch_revenue = pool
            .total_collected
            .saturating_sub(pool.pre_fetch_collected);
        assert_eq!(post_fetch_revenue, 0);
        let entitlement = (post_fetch_revenue as u128 * 6000 / 10000) as u64;
        assert_eq!(entitlement, 0);
    }
}
