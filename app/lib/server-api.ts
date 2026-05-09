/**
 * DataPool client SDK — typed wrapper over the matching server's HTTP API.
 *
 * Stable contract (server publishes `/pool/:hash/metadata` v1). When fields
 * are added the server bumps the `v` discriminator; clients that don't
 * understand a higher version should refuse to verify.
 */

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export type PoolStatus = "pending" | "fetching" | "fetched" | "closed";

export type DataType =
  | "weather"
  | "gps_rtk"
  | "map_imagery"
  | "iot_sensor"
  | "api_response";

/**
 * Mirror of `server/src/store.ts:PoolRecord` (the row that comes back from
 * `GET /pool/:hash` and `GET /pools`). Stable but verbose — most callers
 * should prefer `PoolMetadata` for read-side flows.
 */
export interface Pool {
  requestHashHex: string;
  endpoint: string;
  params: Record<string, string>;
  providerId: string;
  method: string;
  freshnessWindowSecs: number;
  status: PoolStatus;
  buyers: string[];
  createdAt: number;
  fetchedAt?: number;
  dataHash?: string;
  minBuyers: number;
  expiresAt?: number;
}

export interface PoolsResponse {
  pools: Pool[];
  count: number;
}

export interface RequestResponse {
  poolHash: string;
  status: PoolStatus;
  buyerCount: number;
  isNewPool: boolean;
  fetchTriggered: boolean;
  cacheHit: boolean;
  payloadUrl?: string;
  dataHash?: string;
  expiresAt?: number;
  currentPriceUsdc: number;
  currentPriceFormatted: string;
}

/**
 * Read-side metadata view. The server returns this from
 * `GET /pool/:hash/metadata` — it's the "single endpoint" that gives a
 * client everything needed to verify and consume a request.
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

export async function submitRequest(
  endpoint: string,
  params: Record<string, string>,
  buyerPubkey: string,
  dataType: DataType = "api_response",
  options?: { method?: string; freshnessWindowSecs?: number }
): Promise<RequestResponse> {
  const res = await fetch(`${SERVER_URL}/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint,
      params,
      buyerPubkey,
      dataType,
      method: options?.method,
      freshnessWindowSecs: options?.freshnessWindowSecs,
    }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

export async function getPools(): Promise<PoolsResponse> {
  const res = await fetch(`${SERVER_URL}/pools`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

export async function getPool(hash: string): Promise<Pool> {
  const res = await fetch(`${SERVER_URL}/pool/${hash}`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

/**
 * Fetch the typed metadata view for a pool. Throws on 404.
 * Use this instead of `getPool` for read-side flows that drive UI or
 * the buyer's verify-then-sign path.
 */
export async function getPoolMetadata(hash: string): Promise<PoolMetadata> {
  const res = await fetch(`${SERVER_URL}/pool/${hash}/metadata`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const meta = (await res.json()) as PoolMetadata;
  if (meta.v !== 1) {
    throw new Error(`Unsupported PoolMetadata version: ${meta.v}`);
  }
  return meta;
}

/**
 * Pull the cached payload bytes referenced by `metadata.payloadUrl` and
 * verify the SHA-256 hash matches `metadata.dataHash`. The hash check is
 * the only thing standing between buyer and a malicious keeper — a buyer
 * MUST run this before signing a settle receipt for the pool.
 *
 * Returns the raw bytes plus the parsed JSON view (when content-type is
 * application/json). Throws `DataPoolHashMismatchError` on mismatch so
 * callers can branch on the failure mode.
 */
export class DataPoolHashMismatchError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`data hash mismatch: expected ${expected}, got ${actual}`);
    this.name = "DataPoolHashMismatchError";
  }
}

export async function fetchAndVerify(
  metadata: PoolMetadata
): Promise<{ bytes: Uint8Array; data: unknown; verified: true }> {
  if (!metadata.payloadUrl || !metadata.dataHash) {
    throw new Error(
      "PoolMetadata missing payloadUrl or dataHash — pool not yet fetched"
    );
  }

  const res = await fetch(metadata.payloadUrl);
  if (!res.ok) throw new Error(`Payload fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const actualHashHex = await sha256Hex(bytes);
  if (actualHashHex !== metadata.dataHash) {
    throw new DataPoolHashMismatchError(metadata.dataHash, actualHashHex);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let data: unknown = bytes;
  if (contentType.includes("application/json")) {
    data = JSON.parse(new TextDecoder().decode(bytes));
  }
  return { bytes, data, verified: true };
}

/** SHA-256 in hex via Web Crypto API — works in browser + Node 20+. */
export async function sha256Hex(input: Uint8Array): Promise<string> {
  // Cast through ArrayBufferView — TS 5.7+ tightened BufferSource to require
  // the buffer slot to be ArrayBuffer (not the generic ArrayBufferLike).
  const buf = await crypto.subtle.digest(
    "SHA-256",
    input as unknown as ArrayBuffer
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Decay presets (bps per hour) — must match server/src/decay.ts
const DECAY_BPS: Record<DataType, number> = {
  weather: 100,
  gps_rtk: 667,
  map_imagery: 1,
  iot_sensor: 200,
  api_response: 500,
};

// Client-side price calculation (mirrors server decay formula)
export function calcCurrentPriceUsdc(
  basePriceUsdc: number,
  fetchedAtMs: number,
  dataType: DataType,
  nowMs: number = Date.now()
): number {
  if (!fetchedAtMs) return basePriceUsdc;
  const hoursElapsed = (nowMs - fetchedAtMs) / 3_600_000;
  const decayBps = DECAY_BPS[dataType];
  const decay = Math.min(10000, decayBps * hoursElapsed);
  return Math.max(1, Math.floor((basePriceUsdc * (10000 - decay)) / 10000));
}

export function formatUsdc(microUsdc: number): string {
  return `$${(microUsdc / 1_000_000).toFixed(6)} USDC`;
}
