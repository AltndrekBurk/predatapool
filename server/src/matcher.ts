/**
 * Request Deduplication & Pool Formation
 *
 * Incoming data requests are hashed to a canonical 32-byte key (v2 — see
 * `hashRequestV2`). Pool state lives in the persistent `PoolStore` so it
 * survives server restart. Within a freshness window a fetched pool is
 * REUSED — that's the whole point of x402-MPP, and what gates the
 * "reuse fee" decay schedule on-chain.
 */

import { createHash } from "crypto";
import {
  getStore,
  type PayloadRecord,
  type PoolRecord,
  type PoolStatus,
} from "./store.js";

/**
 * Domain prefix for canonical request hashing. Bump the version suffix when
 * key fields change to force a clean cache rollover.
 */
export const REQUEST_KEY_DOMAIN = "DATAPOOL_REQ_V2";

export interface RequestKeyInput {
  /** Base58-encoded provider pubkey from the on-chain provider registry. */
  providerId: string;
  /** HTTP method — uppercased before hashing. */
  method: string;
  /** Full request URL. Only host+path participate in the key; query is merged with params. */
  endpoint: string;
  /** Additional query/body params (override URL query on key collision). */
  params: Record<string, string>;
  /**
   * Buyer's freshness SLO in seconds. Different SLOs are intentionally
   * different pools — a buyer asking for 60s-fresh data must not be served
   * out of a pool that promised 1h-fresh data.
   */
  freshnessWindowSecs: number;
}

export interface DataRequest extends RequestKeyInput {
  buyerPubkey: string;
  maxPriceUsdc: number;
  minBuyers?: number;
}

export type PoolState = PoolRecord;

const POOL_TIMEOUT_MS = 60_000;
const DEFAULT_MIN_BUYERS = 2;

function canonicalEndpoint(endpoint: string): { host: string; path: string } {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  let path = url.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return { host, path };
}

/**
 * Merge URL query string with explicit params (explicit wins). Keys keep
 * their case — query/header semantics commonly preserve case.
 */
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
 * Stable JSON stringify with deterministic key ordering at every depth.
 * Defeats JS engine quirks around integer-like string keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

export function buildCanonicalRequest(input: RequestKeyInput): {
  v: 2;
  provider: string;
  method: string;
  path: string;
  params: Record<string, string>;
  freshness_window_secs: number;
} {
  if (
    !Number.isInteger(input.freshnessWindowSecs) ||
    input.freshnessWindowSecs <= 0
  ) {
    throw new Error("freshnessWindowSecs must be a positive integer");
  }
  if (!input.providerId) {
    throw new Error("providerId is required");
  }
  const { host, path } = canonicalEndpoint(input.endpoint);
  return {
    v: 2,
    provider: input.providerId,
    method: input.method.trim().toUpperCase(),
    path: `${host}${path}`,
    params: effectiveParams(input.endpoint, input.params),
    freshness_window_secs: input.freshnessWindowSecs,
  };
}

export function hashRequestV2(input: RequestKeyInput): Buffer {
  const canon = buildCanonicalRequest(input);
  const hasher = createHash("sha256");
  hasher.update(REQUEST_KEY_DOMAIN);
  hasher.update("\0");
  hasher.update(stableStringify(canon));
  return hasher.digest();
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
  v: 1;
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
    v: 1,
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
    paymentSignature: payload?.paymentSignature,
  };
}
