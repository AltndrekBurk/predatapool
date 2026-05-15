/**
 * Provider Registry — endpoint → on-chain agreement
 *
 * Each entry encodes a provider's AoI-exponential decay agreement:
 *   - buyer-side pricing (basePriceUsdc, buyerLambdaPerHour)
 *   - provider-side revenue share (providerShareBps, providerLambdaPerHour)
 *
 * The keeper looks up an agreement when a new pool is created, converts λ
 * to Q16.16 (via `lambdaToQ16` in decay.ts), and passes the values to
 * `initialize_pool` so they're stored on-chain immutably.
 *
 * MVP: in-memory map keyed by URL hostname. Production should replace this
 * with an on-chain provider registry account so any keeper can resolve it.
 */

import { PublicKey } from "@solana/web3.js";

/**
 * Upstream payment dialect. Unset → endpoint is free or auth'd via API key
 * (existing direct fetch). `mpp` → endpoint speaks the MPP / x402 protocol
 * and the keeper must run the @solana/mpp client to satisfy the 402.
 */
export type UpstreamPayment =
  | { kind: "free" }
  | { kind: "apiKey"; envVar: string }
  | {
      kind: "mpp";
      /** "USDC", "SOL", or a base58-encoded SPL mint address. */
      currency: string;
    };

export interface ProviderAgreement {
  /** Provider's wallet — receives time-decayed revenue share */
  provider: PublicKey;
  /** Buyer-side base price in USDC micro-units (6 decimals) */
  basePriceUsdc: number;
  /** Buyer-side AoI decay rate λ in per-hour; price = base · exp(-λ·Δhr). */
  buyerLambdaPerHour: number;
  /** Provider's base share of post-fetch revenue, in bps */
  providerShareBps: number;
  /** Provider's own AoI decay rate λ in per-hour (data rights age). */
  providerLambdaPerHour: number;
  /** Min buyers before fetch can be triggered */
  minBuyers: number;
  /**
   * Default freshness SLO in seconds for this provider's data. A weather
   * stream defaults to ~60s; map imagery defaults to a day. Buyers may
   * override per-request, but different SLOs deliberately route to
   * different pools (see `RequestKeyInput.freshnessWindowSecs`).
   */
  freshnessWindowSecs: number;
  /** How the keeper authenticates / pays upstream when fetching. */
  upstream: UpstreamPayment;
}

const DEFAULT_PROVIDER = new PublicKey(
  process.env.DEFAULT_PROVIDER_PUBKEY ?? "11111111111111111111111111111111"
);

/**
 * Static registry — replace with on-chain provider lookup later.
 * Pubkeys read from env so deployments can wire real provider keys.
 *
 * λ conversion from old linear `decay_bps_per_hour`:
 *   λ ≈ decay_bps / 10000 (linear ≈ exp at small t)
 */
const REGISTRY: Record<string, ProviderAgreement> = {
  "api.weatherxm.com": {
    provider: process.env.WEATHERXM_PROVIDER_PUBKEY
      ? new PublicKey(process.env.WEATHERXM_PROVIDER_PUBKEY)
      : DEFAULT_PROVIDER,
    basePriceUsdc: 100_000, // $0.10
    buyerLambdaPerHour: 0.01, // half-life ≈ 69hr
    providerShareBps: 6000, // 60% of post-fetch revenue
    providerLambdaPerHour: 0.02, // share half-life ≈ 35hr
    minBuyers: 2,
    freshnessWindowSecs: 60, // weather: 1-minute SLO
    upstream: { kind: "apiKey", envVar: "WEATHERXM_API_KEY" },
  },
  "hivemapper-api.com": {
    provider: process.env.HIVEMAPPER_PROVIDER_PUBKEY
      ? new PublicKey(process.env.HIVEMAPPER_PROVIDER_PUBKEY)
      : DEFAULT_PROVIDER,
    basePriceUsdc: 50_000, // $0.05
    buyerLambdaPerHour: 0.0001, // map imagery: half-life ≈ 290d
    providerShareBps: 5000, // 50%
    providerLambdaPerHour: 0.0005, // provider share half-life ≈ 58d
    minBuyers: 2,
    freshnessWindowSecs: 86_400, // map imagery: 1-day SLO
    upstream: { kind: "apiKey", envVar: "HIVEMAPPER_API_KEY" },
  },
  // The mock-upstream demo target — speaks MPP, charges USDC. Run
  // `npm run mock-upstream` and route requests through this hostname.
  "localhost:4001": {
    provider: process.env.MOCK_PROVIDER_PUBKEY
      ? new PublicKey(process.env.MOCK_PROVIDER_PUBKEY)
      : DEFAULT_PROVIDER,
    basePriceUsdc: 50_000,
    buyerLambdaPerHour: 0.02,
    providerShareBps: 5000,
    providerLambdaPerHour: 0.01,
    minBuyers: 1,
    freshnessWindowSecs: 60,
    upstream: { kind: "mpp", currency: "USDC" },
  },
};

/**
 * Default agreement for unknown endpoints.
 * Conservative pricing + 50/30/20 split (provider/sponsor/buffer).
 */
const FALLBACK_AGREEMENT: ProviderAgreement = {
  provider: DEFAULT_PROVIDER,
  basePriceUsdc: 50_000,
  buyerLambdaPerHour: 0.05, // half-life ≈ 14hr
  providerShareBps: 5000,
  providerLambdaPerHour: 0.01,
  minBuyers: 2,
  freshnessWindowSecs: 300, // unknown endpoints: 5-minute default SLO
  upstream: { kind: "free" },
};

export function lookupProvider(endpoint: string): ProviderAgreement {
  try {
    const url = new URL(endpoint);
    // Match by host:port (mock-upstream uses non-default port 4001), then host alone.
    const hostPort = url.host;
    const hostname = url.hostname;
    return REGISTRY[hostPort] ?? REGISTRY[hostname] ?? FALLBACK_AGREEMENT;
  } catch {
    return FALLBACK_AGREEMENT;
  }
}
