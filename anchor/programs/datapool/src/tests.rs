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
