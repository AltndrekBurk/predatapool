"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

type JsonValue = unknown;

type DebugResult = {
  label: string;
  status: number | "error";
  durationMs: number;
  body?: JsonValue;
  headers?: Record<string, string>;
  error?: string;
};

async function timedFetch(
  label: string,
  input: string,
  init?: RequestInit
): Promise<DebugResult> {
  const started = performance.now();
  try {
    const res = await fetch(input, init);
    const headers = Object.fromEntries(res.headers.entries());
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await res.json()
      : await res.text();
    return {
      label,
      status: res.status,
      durationMs: Math.round(performance.now() - started),
      body,
      headers,
    };
  } catch (err) {
    return {
      label,
      status: "error",
      durationMs: Math.round(performance.now() - started),
      error: (err as Error).message ?? String(err),
    };
  }
}

export default function DebugPage() {
  const [results, setResults] = useState<DebugResult[]>([]);
  const [poolHash, setPoolHash] = useState("");
  const [endpoint, setEndpoint] = useState("http://localhost:4001/paid-data");
  const [buyer, setBuyer] = useState(
    "11111111111111111111111111111111"
  );
  const [loading, setLoading] = useState(false);

  const latest = results[0];
  const prettyLatest = useMemo(
    () => JSON.stringify(latest ?? {}, null, 2),
    [latest]
  );

  async function run(label: string, path: string, init?: RequestInit) {
    setLoading(true);
    const result = await timedFetch(label, `${SERVER_URL}${path}`, init);
    setResults((items) => [result, ...items].slice(0, 20));
    setLoading(false);
    const body = result.body as { poolHash?: string } | undefined;
    if (body?.poolHash) setPoolHash(body.poolHash);
  }

  async function requestPool() {
    await run("POST /request", "/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        method: "GET",
        params: {},
        buyerPubkey: buyer,
        dataType: "api_response",
        freshnessWindowSecs: 60,
      }),
    });
  }

  async function inspectPayload() {
    if (!poolHash) return;
    setLoading(true);
    const started = performance.now();
    try {
      const res = await fetch(`${SERVER_URL}/pool/${poolHash}/payload`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      setResults((items) => [
        {
          label: "GET /pool/:hash/payload",
          status: res.status,
          durationMs: Math.round(performance.now() - started),
          headers: Object.fromEntries(res.headers.entries()),
          body: {
            ciphertextBytes: bytes.length,
            first16Hex: Array.from(bytes.slice(0, 16))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          },
        },
        ...items,
      ]);
    } catch (err) {
      setResults((items) => [
        {
          label: "GET /pool/:hash/payload",
          status: "error",
          durationMs: Math.round(performance.now() - started),
          error: (err as Error).message ?? String(err),
        },
        ...items,
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-low pb-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted">
              PreDataPool
            </p>
            <h1 className="text-2xl font-bold">Debug Console</h1>
          </div>
          <Link
            href="/"
            className="rounded-md border border-border-low px-3 py-2 text-sm hover:bg-card"
          >
            Main app
          </Link>
        </header>

        <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <div className="rounded-lg border border-border-low bg-card p-4">
              <p className="mb-3 text-sm font-semibold">Server</p>
              <div className="space-y-2">
                <button className="debug-btn" onClick={() => run("GET /health", "/health")}>
                  Health
                </button>
                <button className="debug-btn" onClick={() => run("GET /pools", "/pools")}>
                  Pools
                </button>
                <button className="debug-btn" onClick={() => run("GET /batches", "/batches")}>
                  Batches
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-border-low bg-card p-4">
              <p className="mb-3 text-sm font-semibold">Request Flow</p>
              <label className="debug-label">Endpoint</label>
              <input
                className="debug-input"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
              <label className="debug-label mt-3">Buyer pubkey</label>
              <input
                className="debug-input font-mono"
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
              />
              <button className="debug-btn mt-3" onClick={requestPool}>
                POST /request
              </button>
            </div>

            <div className="rounded-lg border border-border-low bg-card p-4">
              <p className="mb-3 text-sm font-semibold">Pool Inspect</p>
              <label className="debug-label">Pool hash</label>
              <input
                className="debug-input font-mono"
                value={poolHash}
                onChange={(e) => setPoolHash(e.target.value)}
              />
              <div className="mt-3 space-y-2">
                <button
                  className="debug-btn"
                  disabled={!poolHash}
                  onClick={() => run("GET /pool/:hash", `/pool/${poolHash}`)}
                >
                  Pool
                </button>
                <button
                  className="debug-btn"
                  disabled={!poolHash}
                  onClick={() =>
                    run("GET /pool/:hash/metadata", `/pool/${poolHash}/metadata`)
                  }
                >
                  Metadata
                </button>
                <button
                  className="debug-btn"
                  disabled={!poolHash}
                  onClick={inspectPayload}
                >
                  Payload Headers
                </button>
                <button
                  className="debug-btn"
                  disabled={!poolHash}
                  onClick={() => run("GET /pool/:hash/batch", `/pool/${poolHash}/batch`)}
                >
                  Batch
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border-low bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Latest Result</p>
                {loading && <span className="text-xs text-muted">Loading...</span>}
              </div>
              <pre className="max-h-[460px] overflow-auto rounded-md bg-background p-4 text-xs leading-relaxed">
                {prettyLatest}
              </pre>
            </div>

            <div className="rounded-lg border border-border-low bg-card p-4">
              <p className="mb-3 text-sm font-semibold">History</p>
              <div className="space-y-2">
                {results.map((r, idx) => (
                  <button
                    key={`${r.label}-${idx}`}
                    className="flex w-full items-center justify-between rounded-md border border-border-low px-3 py-2 text-left text-xs hover:bg-background"
                    onClick={() =>
                      setResults((items) => [
                        items[idx],
                        ...items.filter((_, i) => i !== idx),
                      ])
                    }
                  >
                    <span>{r.label}</span>
                    <span className="font-mono text-muted">
                      {r.status} · {r.durationMs}ms
                    </span>
                  </button>
                ))}
                {results.length === 0 && (
                  <p className="text-sm text-muted">No requests yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
