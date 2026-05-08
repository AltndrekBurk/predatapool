const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export type PoolStatus = "pending" | "fetching" | "fetched";

export type DataType =
  | "weather"
  | "gps_rtk"
  | "map_imagery"
  | "iot_sensor"
  | "api_response";

export interface Pool {
  requestHash: string;
  endpoint: string;
  params: Record<string, string>;
  status: PoolStatus;
  buyers: string[];
  createdAt: number;
  fetchedAt?: number;
  dataHash?: string;
  /** Provider-defined buyer threshold for fetch trigger. */
  minBuyers: number;
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
  currentPriceUsdc: number;
  currentPriceFormatted: string;
}

export async function submitRequest(
  endpoint: string,
  params: Record<string, string>,
  buyerPubkey: string,
  dataType: DataType = "api_response"
): Promise<RequestResponse> {
  const res = await fetch(`${SERVER_URL}/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, params, buyerPubkey, dataType }),
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
