/**
 * Time-Decay Pricing Engine — Age-of-Information exponential decay.
 *
 *   price(t) = base_price · exp(-λ · Δhours)
 *   floor:    1 micro-USDC
 *
 * The on-chain pricing (anchor/programs/datapool/src/state.rs) uses the same
 * formula via a Q16.16 fixed-point `exp_neg_q16`. The off-chain display path
 * here uses native `Math.exp` for clarity; the keeper rounds λ to Q16.16
 * before calling `initialize_pool` so the two stay in agreement.
 *
 * λ choice rules of thumb (`per hour`):
 *   weather:      0.01    (half-life ≈ 69 hr)
 *   gps_rtk:      0.0667  (half-life ≈ 10 hr)
 *   map_imagery:  0.0001  (half-life ≈ 290 days)
 *   iot_sensor:   0.02    (half-life ≈ 35 hr)
 *   api_response: 0.05    (half-life ≈ 14 hr)
 */

export interface DecayConfig {
  basePriceUsdc: number; // USDC micro-units (1 USDC = 1_000_000)
  lambdaPerHour: number; // λ in 1/hour; price decays as exp(-λ·Δhr)
}

/**
 * Calculate the current price for a dataset.
 * @param config - Decay configuration
 * @param fetchedAtMs - Unix ms when data was fetched (0 = not yet fetched)
 * @param nowMs - Current Unix ms (defaults to Date.now())
 */
export function currentPrice(
  config: DecayConfig,
  fetchedAtMs: number,
  nowMs: number = Date.now()
): number {
  if (fetchedAtMs === 0) {
    return config.basePriceUsdc;
  }
  const hoursElapsed = Math.max(0, (nowMs - fetchedAtMs) / 3_600_000);
  const decay = Math.exp(-config.lambdaPerHour * hoursElapsed);
  const price = Math.floor(config.basePriceUsdc * decay);
  return Math.max(1, price);
}

/**
 * Convert a real λ (per hour) to the Q16.16 representation the on-chain
 * program stores. Keeper uses this when calling `initialize_pool`.
 */
export function lambdaToQ16(lambdaPerHour: number): number {
  if (!Number.isFinite(lambdaPerHour) || lambdaPerHour <= 0) {
    throw new Error(`lambdaPerHour must be > 0, got ${lambdaPerHour}`);
  }
  const q = Math.round(lambdaPerHour * 65_536);
  // Same cap as anchor's InvalidDecayLambda check: λ ≤ 1000/hr.
  if (q > 65_536_000) {
    throw new Error(`lambdaPerHour=${lambdaPerHour} exceeds cap (λ ≤ 1000/hr)`);
  }
  return q;
}

/**
 * Format USDC micro-units for display.
 */
export function formatUsdc(microUsdc: number): string {
  return `$${(microUsdc / 1_000_000).toFixed(6)} USDC`;
}

/**
 * Preset decay configs for known DePIN data types.
 */
export const DECAY_PRESETS: Record<string, DecayConfig> = {
  // WeatherXM: city weather updates every 5min, stays useful for hours
  weather: { basePriceUsdc: 100_000, lambdaPerHour: 0.01 }, // half-life ~69hr

  // GEODNET: RTK corrections valid for ~15min windows
  gps_rtk: { basePriceUsdc: 500_000, lambdaPerHour: 0.0667 }, // half-life ~10hr

  // Hivemapper: map imagery stays valid for months
  map_imagery: { basePriceUsdc: 50_000, lambdaPerHour: 0.0001 }, // half-life ~290d

  // Generic IoT sensor read
  iot_sensor: { basePriceUsdc: 10_000, lambdaPerHour: 0.02 }, // half-life ~35hr

  // Generic HTTP API response (short-lived)
  api_response: { basePriceUsdc: 50_000, lambdaPerHour: 0.05 }, // half-life ~14hr
};
