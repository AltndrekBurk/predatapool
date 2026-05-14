/**
 * PoolClient — typed wrapper over the pool node's HTTP API.
 *
 * One instance per node URL. Stateless beyond the configured `baseUrl`;
 * safe to share across coalescing keys. Throws on non-2xx.
 */

import { PoolMetadataVersionError } from "./errors.js";
import type {
  BatchInfo,
  DataType,
  Pool,
  PoolMetadata,
  PoolsResponse,
  RequestResponse,
} from "./types.js";

export interface PoolClientOptions {
  /** Pool node base URL, e.g. `http://localhost:3001`. No trailing slash. */
  baseUrl: string;
  /** Optional fetch implementation — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface SubmitRequestInput {
  endpoint: string;
  params?: Record<string, string>;
  buyerPubkey: string;
  dataType?: DataType;
  method?: string;
  freshnessWindowSecs?: number;
}

export interface ReceiptWire {
  poolHash: string;
  buyer: string;
  maxPrice: string;
  nonce: string;
  deadline: string;
  signedMessage: string;
  signature: string;
}

export class PoolClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PoolClientOptions) {
    if (!options.baseUrl) throw new Error("PoolClient: baseUrl is required");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async submitRequest(input: SubmitRequestInput): Promise<RequestResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: input.endpoint,
        params: input.params ?? {},
        buyerPubkey: input.buyerPubkey,
        dataType: input.dataType,
        method: input.method,
        freshnessWindowSecs: input.freshnessWindowSecs,
      }),
    });
    if (!res.ok) throw new Error(`POST /request failed: ${res.status}`);
    return (await res.json()) as RequestResponse;
  }

  async getPools(): Promise<PoolsResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/pools`);
    if (!res.ok) throw new Error(`GET /pools failed: ${res.status}`);
    return (await res.json()) as PoolsResponse;
  }

  async getPool(hash: string): Promise<Pool> {
    const res = await this.fetchImpl(`${this.baseUrl}/pool/${hash}`);
    if (!res.ok) throw new Error(`GET /pool/${hash} failed: ${res.status}`);
    return (await res.json()) as Pool;
  }

  async getPoolMetadata(hash: string): Promise<PoolMetadata> {
    const res = await this.fetchImpl(`${this.baseUrl}/pool/${hash}/metadata`);
    if (!res.ok) {
      throw new Error(`GET /pool/${hash}/metadata failed: ${res.status}`);
    }
    const meta = (await res.json()) as PoolMetadata;
    if (meta.v !== 2) throw new PoolMetadataVersionError(meta.v as number);
    return meta;
  }

  async getPayload(
    hash: string
  ): Promise<{ bytes: Uint8Array; headers: Headers; status: number }> {
    const res = await this.fetchImpl(`${this.baseUrl}/pool/${hash}/payload`);
    if (!res.ok) {
      throw new Error(`GET /pool/${hash}/payload failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { bytes: new Uint8Array(buf), headers: res.headers, status: res.status };
  }

  async requestKey(
    hash: string,
    body: {
      buyer: string;
      encPubkey: string;
      nonce: string;
      signature: string;
    }
  ): Promise<{
    wrappedKey: string;
    wrappedKeyBytes: number;
    keyCommitment: string;
  }> {
    const res = await this.fetchImpl(`${this.baseUrl}/pool/${hash}/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        err.error ?? `POST /pool/${hash}/key failed: ${res.status}`
      );
    }
    return (await res.json()) as {
      wrappedKey: string;
      wrappedKeyBytes: number;
      keyCommitment: string;
    };
  }

  async submitReceipt(
    wire: ReceiptWire
  ): Promise<{
    ok: true;
    poolHash: string;
    batchSize: number;
    reused: boolean;
  }> {
    const res = await this.fetchImpl(`${this.baseUrl}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wire),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `POST /receipt failed: ${res.status}`);
    }
    return (await res.json()) as {
      ok: true;
      poolHash: string;
      batchSize: number;
      reused: boolean;
    };
  }

  async getBatch(hash: string): Promise<BatchInfo> {
    const res = await this.fetchImpl(`${this.baseUrl}/pool/${hash}/batch`);
    if (!res.ok) {
      throw new Error(`GET /pool/${hash}/batch failed: ${res.status}`);
    }
    return (await res.json()) as BatchInfo;
  }
}
