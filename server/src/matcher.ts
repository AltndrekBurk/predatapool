/**
 * Request Deduplication & Pool Formation
 *
 * Incoming data requests are hashed to a canonical key.
 * If an active pool exists for that key, the buyer is added.
 * Once threshold is met (or timeout expires), fetch is triggered.
 */

import { createHash } from "crypto";

export interface DataRequest {
  endpoint: string;
  params: Record<string, string>;
  buyerPubkey: string;
  maxPriceUsdc: number; // in USDC micro-units (6 decimals)
}

export interface PoolState {
  requestHash: Buffer;
  requestHashHex: string;
  endpoint: string;
  params: Record<string, string>;
  buyers: string[];
  createdAt: number;
  fetchedAt?: number;
  dataHash?: string;
  status: "pending" | "fetching" | "fetched" | "closed";
}

// In-memory pool registry (replace with Redis in production)
const pools = new Map<string, PoolState>();

const POOL_TIMEOUT_MS = 60_000; // 60s: trigger fetch even if threshold not met
const MIN_BUYERS = 2; // minimum buyers before auto-fetch

/**
 * Hash a data request to a canonical 32-byte key.
 * Deterministic: same endpoint + sorted params = same hash.
 */
export function hashRequest(endpoint: string, params: Record<string, string>): Buffer {
  const canonical = JSON.stringify({
    endpoint,
    params: Object.fromEntries(Object.entries(params).sort()),
  });
  return createHash("sha256").update(canonical).digest();
}

/**
 * Add a buyer to an existing or new pool.
 * Returns the pool state (including whether fetch should be triggered).
 */
export function joinPool(request: DataRequest): {
  pool: PoolState;
  shouldTriggerFetch: boolean;
  isNewPool: boolean;
} {
  const hash = hashRequest(request.endpoint, request.params);
  const hashHex = hash.toString("hex");

  let isNewPool = false;
  let pool = pools.get(hashHex);

  if (!pool || pool.status === "fetched" || pool.status === "closed") {
    // Create new pool for this request
    pool = {
      requestHash: hash,
      requestHashHex: hashHex,
      endpoint: request.endpoint,
      params: request.params,
      buyers: [],
      createdAt: Date.now(),
      status: "pending",
    };
    pools.set(hashHex, pool);
    isNewPool = true;
    console.log(`[matcher] New pool created: ${hashHex.slice(0, 16)}...`);
  }

  // Add buyer if not already in pool
  if (!pool.buyers.includes(request.buyerPubkey)) {
    pool.buyers.push(request.buyerPubkey);
    console.log(
      `[matcher] Buyer ${request.buyerPubkey.slice(0, 8)}... joined pool ${hashHex.slice(0, 8)}... (${pool.buyers.length} buyers)`
    );
  }

  const ageMs = Date.now() - pool.createdAt;
  const shouldTriggerFetch =
    pool.status === "pending" &&
    (pool.buyers.length >= MIN_BUYERS || ageMs >= POOL_TIMEOUT_MS);

  return { pool, shouldTriggerFetch, isNewPool };
}

export function markFetching(hashHex: string): void {
  const pool = pools.get(hashHex);
  if (pool) pool.status = "fetching";
}

export function markFetched(hashHex: string, dataHash: string): void {
  const pool = pools.get(hashHex);
  if (pool) {
    pool.status = "fetched";
    pool.fetchedAt = Date.now();
    pool.dataHash = dataHash;
  }
}

export function getPool(hashHex: string): PoolState | undefined {
  return pools.get(hashHex);
}

export function getAllPools(): PoolState[] {
  return Array.from(pools.values());
}
