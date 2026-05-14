/**
 * Wire-shape types — the read-side contract pinned by the pool node's
 * `buildPoolMetadata` (server/src/matcher.ts). Bumping any field name in the
 * server requires a `v` discriminator bump here and a coordinated SDK release.
 */

export type PoolStatus = "pending" | "fetching" | "fetched" | "closed";

export type DataType =
  | "weather"
  | "gps_rtk"
  | "map_imagery"
  | "iot_sensor"
  | "api_response";

export interface Pool {
  requestHashHex: string;
  endpoint: string;
  params: Record<string, string>;
  providerId: string;
  method: string;
  freshnessWindowSecs: number;
  status: PoolStatus;
  buyers: string[];
  authorizedBuyers: string[];
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

export interface BatchInfo {
  poolHash: string;
  pending: number;
  receipts: Array<{
    buyer: string;
    maxPrice: string;
    nonce: string;
    deadline: string;
    receivedAt: number;
  }>;
}
