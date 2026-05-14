/**
 * Request Coalescing & Pool Formation — server side.
 *
 * Data-layer half of PreDataPool's Cloudflare-style "fetch once, share N
 * ways" model. Canonical-key hashing + canonical-request shape live in
 * `@predatapool/sdk` so client (singleflight) and server (pool dedup) use
 * the same 32-byte key.
 *
 * State here: the persistent `PoolStore` (SQLite). Within a freshness
 * window a fetched pool is REUSED — that's the coalescing semantic; the
 * SDK's `Singleflight` adds in-flight fan-in for concurrent callers in
 * the same process.
 */

import {
  buildCanonicalRequest as buildCanonicalRequestSdk,
  hashRequestV2 as hashRequestV2Sdk,
  REQUEST_KEY_DOMAIN,
  type RequestKeyInput,
} from "@predatapool/sdk";
import {
  getStore,
  type PayloadRecord,
  type PoolRecord,
  type PoolStatus,
} from "./store.js";

export { REQUEST_KEY_DOMAIN };
export type { RequestKeyInput };

/** Wrapper preserving the existing `Buffer` return shape for server callers. */
export function hashRequestV2(input: RequestKeyInput): Buffer {
  return Buffer.from(hashRequestV2Sdk(input));
}

export const buildCanonicalRequest = buildCanonicalRequestSdk;

export interface DataRequest extends RequestKeyInput {
  buyerPubkey: string;
  maxPriceUsdc: number;
  minBuyers?: number;
}

export type PoolState = PoolRecord;

const POOL_TIMEOUT_MS = 60_000;
const DEFAULT_MIN_BUYERS = 2;

function effectiveParams(
  endpoint: string,
  params: Record<string, string>
): Record<string, string> {
  const url = new URL(endpoint);
  const merged: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    merged[k] = v;
  });
  for (const [k, v] of Object.entries(params)) {
    merged[k] = v;
  }
  return merged;
}

/**
 * Tells whether a pool can absorb a new buyer (instead of being replaced).
 *
 * `pending` / `fetching` always reuse — the same fetch is in progress.
 * `fetched` reuses ONLY if the freshness window has not expired; that's
 * the cache-hit case that drives the reuse-fee story. `closed` and
 * expired-fetched pools are dead.
 */
function isReusable(pool: PoolRecord, now: number): boolean {
  if (pool.status === "pending" || pool.status === "fetching") return true;
  if (pool.status === "fetched") {
    return pool.expiresAt !== undefined && pool.expiresAt > now;
  }
  return false;
}

export function joinPool(request: DataRequest): {
  pool: PoolRecord;
  shouldTriggerFetch: boolean;
  isNewPool: boolean;
  cacheHit: boolean;
} {
  const store = getStore();
  const hash = hashRequestV2(request);
  const hashHex = hash.toString("hex");
  const now = Date.now();

  let pool = store.getPool(hashHex);
  let isNewPool = false;

  if (!pool || !isReusable(pool, now)) {
    pool = {
      requestHashHex: hashHex,
      endpoint: request.endpoint,
      params: effectiveParams(request.endpoint, request.params),
      providerId: request.providerId,
      method: request.method.trim().toUpperCase(),
      freshnessWindowSecs: request.freshnessWindowSecs,
      buyers: [],
      authorizedBuyers: [],
      createdAt: now,
      status: "pending",
      minBuyers: request.minBuyers ?? DEFAULT_MIN_BUYERS,
    };
    // upsert because the prior row may exist but be expired/closed
    store.upsertPool(pool);
    isNewPool = true;
    console.log(
      `[matcher] New pool ${hashHex.slice(0, 16)}... ` +
        `(provider=${request.providerId.slice(0, 6)}.. method=${pool.method} ` +
        `fresh=${pool.freshnessWindowSecs}s min_buyers=${pool.minBuyers})`
    );
  }

  const newlyAdded = store.addBuyer(hashHex, request.buyerPubkey);
  if (newlyAdded) {
    pool.buyers.push(request.buyerPubkey);
    console.log(
      `[matcher] Buyer ${request.buyerPubkey.slice(0, 8)}... joined pool ` +
        `${hashHex.slice(0, 8)}... (${pool.buyers.length} buyers)`
    );
  }

  // Cache hit = pool was already fetched and still fresh; no fetch needed.
  const cacheHit = pool.status === "fetched";
  const ageMs = now - pool.createdAt;
  const shouldTriggerFetch =
    pool.status === "pending" &&
    (pool.buyers.length >= pool.minBuyers || ageMs >= POOL_TIMEOUT_MS);

  return { pool, shouldTriggerFetch, isNewPool, cacheHit };
}

export function markFetching(hashHex: string): void {
  getStore().setStatus(hashHex, "fetching");
}

/**
 * Record a successful fetch + start the TTL clock.
 * `expiresAt = fetchedAt + freshness_window_secs` — once that elapses, the
 * pool is stale and a fresh request to the upstream is required (and a
 * new payment to the provider).
 */
export function markFetched(hashHex: string, dataHash: string): void {
  const store = getStore();
  const pool = store.getPool(hashHex);
  if (!pool) return;
  const fetchedAt = Date.now();
  const expiresAt = fetchedAt + pool.freshnessWindowSecs * 1000;
  store.recordFetched(hashHex, dataHash, fetchedAt, expiresAt);
}

export function setStatus(hashHex: string, status: PoolStatus): void {
  getStore().setStatus(hashHex, status);
}

export function getPool(hashHex: string): PoolRecord | undefined {
  return getStore().getPool(hashHex);
}

export function getAllPools(): PoolRecord[] {
  return getStore().listPools();
}

/**
 * Versioned read-side metadata view — the shape served by
 * `GET /pool/:hash/metadata` and consumed by the app SDK.
 *
 * This is the protocol's stable read-side contract. Don't mutate field
 * names without bumping the `v` discriminator and updating SDK consumers.
 */
export interface PoolMetadata {
  v: 2;
  poolHash: string;
  status: PoolStatus;
  cacheHit: boolean;
  providerId: string;
  method: string;
  endpoint: string;
  freshnessWindowSecs: number;
  buyerCount: number;
  minBuyers: number;
  createdAt: number;
  fetchedAt?: number;
  expiresAt?: number;
  dataHash?: string;
  storageUri?: string;
  payloadUrl?: string;
  envelope?: {
    version: 0;
    sourceUrl: string;
    sourceHash: string;
    merkleRoot: string;
    keeperPubkey: string;
    keeperSignature: string;
  };
  paymentSignature?: string;
}

/**
 * Project a pool + its cached payload into the public read-side shape.
 * Pure (no I/O) so tests can pin the contract without booting Express.
 *
 * `cacheHit` mirrors the matcher's reuse predicate: a fetched pool is a
 * cache hit ONLY while still inside its freshness window.
 */
export function buildPoolMetadata(
  pool: PoolRecord,
  payload: PayloadRecord | undefined,
  baseUrl: string,
  now: number = Date.now()
): PoolMetadata {
  const isFresh =
    pool.status === "fetched" &&
    pool.expiresAt !== undefined &&
    pool.expiresAt > now;
  const payloadUrl = payload
    ? `${baseUrl}/pool/${pool.requestHashHex}/payload`
    : undefined;
  return {
    v: 2,
    poolHash: pool.requestHashHex,
    status: pool.status,
    cacheHit: isFresh,
    providerId: pool.providerId,
    method: pool.method,
    endpoint: pool.endpoint,
    freshnessWindowSecs: pool.freshnessWindowSecs,
    buyerCount: pool.buyers.length,
    minBuyers: pool.minBuyers,
    createdAt: pool.createdAt,
    fetchedAt: pool.fetchedAt,
    expiresAt: pool.expiresAt,
    dataHash: pool.dataHash,
    storageUri:
      pool.status === "fetched"
        ? `${baseUrl}/pool/${pool.requestHashHex}/payload`
        : undefined,
    payloadUrl,
    envelope: payload
      ? {
          version: 0,
          sourceUrl: payload.sourceUrl,
          sourceHash: payload.sourceHash.toString("hex"),
          merkleRoot: payload.merkleRoot.toString("hex"),
          keeperPubkey: payload.keeperPubkey.toString("hex"),
          keeperSignature: payload.keeperSignature.toString("hex"),
        }
      : undefined,
    paymentSignature: payload?.paymentSignature,
  };
}
