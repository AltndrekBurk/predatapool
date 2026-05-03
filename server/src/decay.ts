/**
 * Time-Decay Pricing Engine
 *
 * Price formula: base_price * max(0, 10000 - decay_bps * hours_elapsed) / 10000
 * Floor: 1 micro-USDC (prevents free access)
 *
 * Example decay rates:
 *   Weather data:  100 bps/hr  → full price for 1hr, free after 100hrs
 *   GPS/RTK data:  50  bps/hr  → slower decay (precision data stays valuable)
 *   Stock prices:  500 bps/hr  → fast decay (stale after 20hrs)
 *   Map imagery:   10  bps/hr  → very slow (maps are durable)
 */

export interface DecayConfig {
  basePriceUsdc: number; // USDC micro-units (1 USDC = 1_000_000)
  decayBpsPerHour: number; // basis points per hour (100 = 1%/hr)
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
    // Not yet fetched → pre-fetch sponsor price (full price)
    return config.basePriceUsdc;
  }

  const hoursElapsed = (nowMs - fetchedAtMs) / 3_600_000;
  const decayBps = Math.floor(config.decayBpsPerHour * hoursElapsed);
  const remainingBps = Math.max(0, 10_000 - decayBps);
  const price = Math.floor((config.basePriceUsdc * remainingBps) / 10_000);

  return Math.max(1, price); // floor: 1 micro-USDC
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
  weather: { basePriceUsdc: 100_000, decayBpsPerHour: 100 }, // $0.10, -1%/hr

  // GEODNET: RTK corrections valid for ~15min windows
  gps_rtk: { basePriceUsdc: 500_000, decayBpsPerHour: 667 }, // $0.50, -6.67%/hr

  // Hivemapper: map imagery stays valid for months
  map_imagery: { basePriceUsdc: 50_000, decayBpsPerHour: 1 }, // $0.05, -0.01%/hr

  // Generic IoT sensor read
  iot_sensor: { basePriceUsdc: 10_000, decayBpsPerHour: 200 }, // $0.01, -2%/hr

  // Generic HTTP API response (short-lived)
  api_response: { basePriceUsdc: 50_000, decayBpsPerHour: 500 }, // $0.05, -5%/hr
};
