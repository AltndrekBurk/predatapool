/**
 * App-side HTTP client — thin wrappers around `@predatapool/sdk`'s
 * `PoolClient` that capture `NEXT_PUBLIC_SERVER_URL` once and expose the
 * legacy function-shaped API the existing components consume.
 *
 * The PoolClient is constructed lazily so SSR + client share the same
 * instance for a given URL but stay free to override per-call.
 */

import {
  PoolClient,
  type DataType,
  type PoolMetadata as SdkPoolMetadata,
  type Pool as SdkPool,
  type PoolsResponse as SdkPoolsResponse,
  type RequestResponse as SdkRequestResponse,
  sha256Hex,
} from "@predatapool/sdk";
import {
  DataPoolHashMismatchError,
  PoolMetadataVersionError,
} from "@predatapool/sdk";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

let cachedClient: PoolClient | undefined;
function client(): PoolClient {
  if (!cachedClient) cachedClient = new PoolClient({ baseUrl: SERVER_URL });
  return cachedClient;
}

export type { DataType };
export type PoolStatus = SdkPool["status"];
export type Pool = SdkPool;
export type PoolsResponse = SdkPoolsResponse;
export type RequestResponse = SdkRequestResponse;
export type PoolMetadata = SdkPoolMetadata;
export { DataPoolHashMismatchError, PoolMetadataVersionError };

export async function submitRequest(
  endpoint: string,
  params: Record<string, string>,
  buyerPubkey: string,
  dataType: DataType = "api_response",
  options?: { method?: string; freshnessWindowSecs?: number }
): Promise<RequestResponse> {
  return client().submitRequest({
    endpoint,
    params,
    buyerPubkey,
    dataType,
    method: options?.method,
    freshnessWindowSecs: options?.freshnessWindowSecs,
  });
}

export function getPools(): Promise<PoolsResponse> {
  return client().getPools();
}

export function getPool(hash: string): Promise<Pool> {
  return client().getPool(hash);
}

export function getPoolMetadata(hash: string): Promise<PoolMetadata> {
  return client().getPoolMetadata(hash);
}

/**
 * Fetch + verify the payload referenced by `metadata.payloadUrl`.
 * Hash check is the only thing standing between buyer and a malicious keeper.
 */
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

export { sha256Hex };

// Decay presets (bps per hour) — must match server/src/decay.ts
const DECAY_BPS: Record<DataType, number> = {
  weather: 100,
  gps_rtk: 667,
  map_imagery: 1,
  iot_sensor: 200,
  api_response: 500,
};

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
