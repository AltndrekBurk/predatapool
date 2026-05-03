/**
 * Data Fetcher — x402 / HTTP data acquisition layer
 *
 * Handles the single fetch per pool. Supports:
 *   1. Direct HTTP (free or API-key authenticated endpoints)
 *   2. x402 payment-required endpoints (via @solana-foundation/mpp-sdk pattern)
 *
 * After fetch, computes SHA-256 of the response for on-chain registration.
 */

import { createHash } from "crypto";

export interface FetchResult {
  data: unknown;
  dataHash: Buffer; // SHA-256 of JSON.stringify(data)
  fetchedAt: number; // Unix ms
  source: string;
}

/**
 * Fetch data from an endpoint.
 * For x402 endpoints, the caller should provide a signed payment proof.
 */
export async function fetchData(
  endpoint: string,
  params: Record<string, string>,
  options?: {
    apiKey?: string;
    x402PaymentProof?: string; // base64-encoded x402 payment header
    timeoutMs?: number;
  }
): Promise<FetchResult> {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "DataPool-Protocol/0.1",
  };

  if (options?.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  if (options?.x402PaymentProof) {
    // x402 protocol: include payment proof in header
    // https://x402.org — Payment-Signature header
    headers["X-PAYMENT"] = options.x402PaymentProof;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? 10_000
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 402) {
    // x402: Payment Required — extract payment details from response
    const paymentDetails = await response.json();
    throw new Error(
      `x402 payment required: ${JSON.stringify(paymentDetails)}`
    );
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const dataJson = JSON.stringify(data);
  const dataHash = createHash("sha256").update(dataJson).digest();

  console.log(
    `[fetcher] Fetched from ${endpoint} — hash: ${dataHash.toString("hex").slice(0, 16)}...`
  );

  return {
    data,
    dataHash,
    fetchedAt: Date.now(),
    source: endpoint,
  };
}

/**
 * WeatherXM adapter — fetch city weather data
 * https://api.weatherxm.com/api/v1/cells/{cellIndex}/devices
 */
export async function fetchWeatherXM(
  cellIndex: string,
  apiKey?: string
): Promise<FetchResult> {
  return fetchData(
    `https://api.weatherxm.com/api/v1/cells/${cellIndex}/devices`,
    {},
    { apiKey }
  );
}

/**
 * Hivemapper adapter — fetch map coverage data
 */
export async function fetchHivemapper(
  lat: string,
  lng: string,
  zoom: string = "14",
  apiKey?: string
): Promise<FetchResult> {
  return fetchData(
    "https://hivemapper-api.com/developer/imagery/coverage",
    { lat, lng, zoom },
    { apiKey }
  );
}
