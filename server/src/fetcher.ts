/**
 * Data Fetcher — payload acquisition layer
 *
 * Three modes, picked by the provider's `UpstreamPayment` agreement:
 *   1. `free` — plain HTTP fetch
 *   2. `apiKey` — plain HTTP fetch + Bearer header from env
 *   3. `mpp`   — go through `@solana/mpp` client; the SDK handles the
 *               402 → sign payment → retry → 200 loop transparently
 *
 * After fetch, computes SHA-256 of the response body for on-chain
 * registration via `register_dataset`.
 */

import { createHash } from "crypto";
import { Mppx, solana } from "@solana/mpp/client";
import type { KeyPairSigner } from "@solana/kit";
import type { UpstreamPayment } from "./providers.js";

export interface FetchResult {
  data: unknown;
  rawBody: Buffer;
  contentType: string;
  dataHash: Buffer; // SHA-256 of raw response body
  fetchedAt: number;
  source: string;
  /** Set when the fetch went through MPP — useful for accounting. */
  paymentSignature?: string;
}

export interface FetchOptions {
  upstream: UpstreamPayment;
  /** Required when upstream.kind === "mpp". */
  mppSigner?: KeyPairSigner;
  rpcUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000; // MPP loop can take ~10s on devnet, give headroom

/**
 * Lazily-built mppx client per (signer, rpcUrl) pair. The keeper has one
 * signer for the whole process, so in practice this resolves to a single
 * instance — but keying by signer.address means swapping signers in tests
 * doesn't poison the cache.
 */
const mppxCache = new Map<string, ReturnType<typeof Mppx.create>>();

function getMppx(signer: KeyPairSigner, rpcUrl: string) {
  const cacheKey = `${signer.address}@${rpcUrl}`;
  let instance = mppxCache.get(cacheKey);
  if (!instance) {
    instance = Mppx.create({
      methods: [solana.charge({ signer, rpcUrl })],
    });
    mppxCache.set(cacheKey, instance);
  }
  return instance;
}

export async function fetchData(
  endpoint: string,
  params: Record<string, string>,
  options: FetchOptions
): Promise<FetchResult> {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "DataPool-Protocol/0.1",
  };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let paymentSignature: string | undefined;

  try {
    if (options.upstream.kind === "mpp") {
      if (!options.mppSigner) {
        throw new Error(
          "fetcher: upstream.kind=mpp but no mppSigner provided"
        );
      }
      if (!options.rpcUrl) {
        throw new Error("fetcher: upstream.kind=mpp but no rpcUrl provided");
      }

      const mppx = getMppx(options.mppSigner, options.rpcUrl);
      response = await mppx.fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
        // Capture the final payment tx signature from the SDK's progress events.
        // This lets us record the proof on-chain alongside the data hash.
        onProgress: (event: { type: string; signature?: string }) => {
          if (event.type === "paid" && event.signature) {
            paymentSignature = event.signature;
          }
        },
      } as Parameters<typeof mppx.fetch>[1]);
    } else {
      if (options.upstream.kind === "apiKey") {
        const key = process.env[options.upstream.envVar];
        if (key) headers.Authorization = `Bearer ${key}`;
      }
      response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    // For MPP-mode this is unexpected — the SDK would have surfaced 402
    // by completing the payment loop. A non-2xx here means the upstream
    // refused even after payment, or there's a non-payment error.
    const body = await response.text().catch(() => "");
    throw new Error(`upstream fetch failed: HTTP ${response.status} ${body}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown;
  let raw: string;
  if (contentType.includes("application/json")) {
    raw = await response.text();
    data = JSON.parse(raw);
  } else {
    raw = await response.text();
    data = raw;
  }

  // Hash the raw body verbatim — JSON.stringify(parsed) reorders keys
  // and would yield non-deterministic hashes. Buyers verifying off-chain
  // must run the identical bytes through SHA-256.
  const dataHash = createHash("sha256").update(raw).digest();

  console.log(
    `[fetcher] Fetched ${url.toString()} via ${options.upstream.kind} ` +
      `— hash: ${dataHash.toString("hex").slice(0, 16)}...` +
      (paymentSignature ? ` payment: ${paymentSignature.slice(0, 8)}...` : "")
  );

  return {
    data,
    rawBody: Buffer.from(raw),
    contentType,
    dataHash,
    fetchedAt: Date.now(),
    source: endpoint,
    paymentSignature,
  };
}
