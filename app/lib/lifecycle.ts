/**
 * Pool lifecycle vocabulary — semantic mapping over the raw on-chain /
 * server `status`. UI must reach for these labels rather than the raw
 * `pending|fetching|fetched|closed` strings, which don't surface the
 * cache-hit story that's the whole point of x402-MPP.
 *
 * pending  → "Pooling"   : collecting buyers, no upstream call yet
 * fetching → "Fetching"  : keeper paying upstream + pulling bytes
 * fetched + fresh → "Cached"  : payment already done; reuse window open
 * fetched + expired → "Stale" : freshness elapsed; next request refetches
 * closed → "Closed"
 */

import type { Pool, PoolStatus } from "./server-api";

export type Lifecycle = "pooling" | "fetching" | "cached" | "stale" | "closed";

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  pooling: "Pooling",
  fetching: "Fetching",
  cached: "Cached",
  stale: "Stale",
  closed: "Closed",
};

export const LIFECYCLE_DESCRIPTION: Record<Lifecycle, string> = {
  pooling: "Collecting buyers — fetch fires at threshold",
  fetching: "Keeper paying upstream + downloading data",
  cached: "Payment already done — payload served from cache",
  stale: "Freshness window expired — next request refetches",
  closed: "Pool closed",
};

/**
 * Tailwind tokens for the lifecycle badges. Kept here so the card,
 * KPI strip, and request form draw the same color for the same state.
 */
export const LIFECYCLE_BADGE: Record<Lifecycle, string> = {
  pooling: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  fetching: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  cached: "bg-green-500/15 text-green-700 dark:text-green-300",
  stale: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  closed: "bg-cream text-muted",
};

export const LIFECYCLE_DOT: Record<Lifecycle, string> = {
  pooling: "bg-yellow-400",
  fetching: "bg-blue-400 animate-pulse",
  cached: "bg-green-400",
  stale: "bg-orange-400",
  closed: "bg-muted",
};

export function poolLifecycle(
  status: PoolStatus,
  expiresAt: number | undefined,
  now: number = Date.now()
): Lifecycle {
  switch (status) {
    case "closed":
      return "closed";
    case "fetching":
      return "fetching";
    case "fetched":
      return expiresAt !== undefined && expiresAt > now ? "cached" : "stale";
    case "pending":
    default:
      return "pooling";
  }
}

/**
 * Aggregate KPIs computed off the pool list — the saving story for the
 * demo strip. "Fetches saved" counts every additional buyer in a fetched
 * pool as one upstream fetch + payment that didn't have to happen.
 */
export interface PoolKpis {
  poolsActive: number;
  agentsJoined: number;
  fetchesSaved: number;
  /** USDC micro-units saved (fetches × per-fetch base price). */
  feesSavedMicroUsdc: number;
}

const PER_FETCH_BASE_USDC_MICROS = 1_000_000;

export function computeKpis(pools: Pool[], now: number = Date.now()): PoolKpis {
  let poolsActive = 0;
  let agentsJoined = 0;
  let fetchesSaved = 0;

  for (const p of pools) {
    const lc = poolLifecycle(p.status, p.expiresAt, now);
    if (lc !== "closed" && lc !== "stale") poolsActive++;
    agentsJoined += p.buyers.length;
    if (lc === "cached" || lc === "fetching") {
      fetchesSaved += Math.max(0, p.buyers.length - 1);
    }
  }

  return {
    poolsActive,
    agentsJoined,
    fetchesSaved,
    feesSavedMicroUsdc: fetchesSaved * PER_FETCH_BASE_USDC_MICROS,
  };
}
