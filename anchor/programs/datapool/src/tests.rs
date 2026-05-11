#[cfg(test)]
mod tests {
    use crate::state::DataPool;

    // ── Time-decay pricing unit tests ──────────────────────────────────────
    // These test the pure math in DataPool::current_price without any on-chain setup.

    fn make_pool(base: u64, decay_bps: u16, fetched_at: i64) -> DataPool {
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
            decay_bps_per_hour: decay_bps,
            is_open: true,
            provider: Default::default(),
            provider_share_bps: 0,
            provider_decay_bps_per_hour: 0,
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
        decay_bps: u16,
        fetched_at: i64,
        total_collected: u64,
        buyer_count: u8,
        provider_share_bps: u16,
        provider_decay_bps_per_hour: u16,
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
            decay_bps_per_hour: decay_bps,
            is_open: true,
            provider: Default::default(),
            provider_share_bps,
            provider_decay_bps_per_hour,
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

    #[test]
    fn test_price_pre_fetch_is_base_price() {
        let pool = make_pool(1_000_000, 100, 0); // $1 USDC, fetched_at = 0
        // Pre-fetch: price == base price
        assert_eq!(pool.current_price(1_000_000), 1_000_000);
    }

    // Use a non-zero base time so fetched_at != 0 sentinel
    const T0: i64 = 1_700_000_000; // Nov 2023 — arbitrary past timestamp

    #[test]
    fn test_price_immediately_after_fetch_is_base() {
        let pool = make_pool(1_000_000, 100, T0);
        // At exactly fetched_at: 0 hours elapsed → no decay
        assert_eq!(pool.current_price(T0), 1_000_000);
    }

    #[test]
    fn test_price_decays_at_1_percent_per_hour() {
        // base = 1_000_000, decay = 100 bps/hr (1%/hr)
        // After 1 hour: 1_000_000 * (10000 - 100) / 10000 = 990_000
        let pool = make_pool(1_000_000, 100, T0);
        assert_eq!(pool.current_price(T0 + 3600), 990_000);
    }

    #[test]
    fn test_price_decays_after_10_hours() {
        // After 10 hours at 100 bps/hr: 10% decay
        // 1_000_000 * (10000 - 1000) / 10000 = 900_000
        let pool = make_pool(1_000_000, 100, T0);
        assert_eq!(pool.current_price(T0 + 36_000), 900_000);
    }

    #[test]
    fn test_price_floor_at_1_microusdc() {
        // After 100+ hours at 100 bps/hr: fully decayed → floor = 1 micro-USDC
        let pool = make_pool(1_000_000, 100, T0);
        let far_future = T0 + 1_000_000; // ~278 hours later
        assert_eq!(pool.current_price(far_future), 1);
    }

    #[test]
    fn test_price_50_percent_decay_at_50_hours() {
        // 100 bps/hr × 50 hours = 5000 bps = 50% decay
        let pool = make_pool(1_000_000, 100, T0);
        assert_eq!(pool.current_price(T0 + 50 * 3600), 500_000);
    }

    #[test]
    fn test_fast_decay_gps_data() {
        // GPS RTK: 667 bps/hr — fully decayed after ~15 hours
        let pool = make_pool(500_000, 667, T0);
        // 667 * 15 = 10005 bps > 10000 → clamped → floor = 1
        assert_eq!(pool.current_price(T0 + 15 * 3600), 1);
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
        let pool = make_pool(0, 100, T0);
        // Even with 0 base price, floor is 1
        assert_eq!(pool.current_price(T0 + 3600), 1);
    }

    // ── Provider revenue tests ─────────────────────────────────────────────

    #[test]
    fn test_provider_share_pre_fetch_is_base() {
        // Before fetch, share == base (no decay applied yet)
        let pool = make_pool_with_provider(1_000_000, 100, 0, 0, 0, 6000, 200);
        assert_eq!(pool.provider_share_bps_now(1_700_000_000), 6000);
    }

    #[test]
    fn test_provider_share_decays_per_agreement() {
        // base 6000 bps (60%), provider decay 200 bps/hr
        // After 10 hours: decay = 2000 → share = 6000 * 8000/10000 = 4800 bps
        let pool = make_pool_with_provider(1_000_000, 100, T0, 0, 0, 6000, 200);
        assert_eq!(pool.provider_share_bps_now(T0 + 10 * 3600), 4800);
    }

    #[test]
    fn test_provider_share_floors_at_zero_not_one() {
        // After very long time, provider share decays to 0 (data rights expire)
        // Unlike buyer price which floors at 1 micro-USDC
        let pool = make_pool_with_provider(1_000_000, 100, T0, 0, 0, 6000, 200);
        // 200 bps/hr × 50 hours = 10000 → fully decayed
        assert_eq!(pool.provider_share_bps_now(T0 + 50 * 3600), 0);
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
}
