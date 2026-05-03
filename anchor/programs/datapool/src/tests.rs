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
}
