/**
 * Canonical request hashing — the spine of request coalescing.
 *
 * Two callers with identical (provider, method, host+path, params, freshness
 * window) produce the same 32-byte hash → same pool → one upstream fetch.
 *
 * Mirrors `server/src/matcher.ts:hashRequestV2`. Used by both the SDK's
 * client-side singleflight and the pool node's matcher.
 */

import { sha256 } from "@noble/hashes/sha2.js";

export const REQUEST_KEY_DOMAIN = "DATAPOOL_REQ_V2";

export interface RequestKeyInput {
  /** Base58 provider pubkey from the on-chain provider registry. */
  providerId: string;
  /** HTTP method — uppercased before hashing. */
  method: string;
  /** Full request URL. Only host+path participate; query is merged with params. */
  endpoint: string;
  /** Additional query/body params (override URL query on key collision). */
  params: Record<string, string>;
  /**
   * Buyer's freshness SLO in seconds. Different SLOs are intentionally
   * different pools — a 60s-fresh request must not be served from a pool
   * that promised 1h-fresh data.
   */
  freshnessWindowSecs: number;
}

function canonicalEndpoint(endpoint: string): { host: string; path: string } {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  let path = url.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return { host, path };
}

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

export interface CanonicalRequest {
  v: 2;
  provider: string;
  method: string;
  path: string;
  params: Record<string, string>;
  freshness_window_secs: number;
}

export function buildCanonicalRequest(
  input: RequestKeyInput
): CanonicalRequest {
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

/**
 * 32-byte canonical pool key. Domain-prefixed SHA-256 over the stable
 * stringification of the canonical request — JS object key ordering and
 * URL query order can't change the output.
 */
export function hashRequestV2(input: RequestKeyInput): Uint8Array {
  const canon = buildCanonicalRequest(input);
  const domain = new TextEncoder().encode(REQUEST_KEY_DOMAIN);
  const sep = new Uint8Array([0]);
  const body = new TextEncoder().encode(stableStringify(canon));
  const out = new Uint8Array(domain.length + 1 + body.length);
  out.set(domain, 0);
  out.set(sep, domain.length);
  out.set(body, domain.length + 1);
  return sha256(out);
}

export function hashRequestV2Hex(input: RequestKeyInput): string {
  const bytes = hashRequestV2(input);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
