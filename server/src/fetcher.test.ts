/**
 * Fetcher tests.
 *
 * Covers the deterministic free + apiKey paths using an in-process HTTP
 * server. The `mpp` path requires a real Solana RPC + signer + USDC mint
 * and is exercised by the manual `mock-upstream` smoke flow, not here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { createHash } from "crypto";
import { fetchData } from "./fetcher.js";

interface Server {
  url: string;
  close: () => Promise<void>;
  hits: () => number;
  lastHeaders: () => http.IncomingHttpHeaders;
}

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<Server> {
  let count = 0;
  let lastHeaders: http.IncomingHttpHeaders = {};
  const srv = http.createServer((req, res) => {
    count++;
    lastHeaders = req.headers;
    handler(req, res);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r) => srv.close(() => r())),
    hits: () => count,
    lastHeaders: () => lastHeaders,
  };
}

test("free upstream returns parsed JSON and SHA-256 of raw body", async () => {
  const body = '{"hello":"world","n":42}';
  const server = await withServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });
  try {
    const result = await fetchData(
      server.url,
      {},
      { upstream: { kind: "free" } }
    );
    assert.deepEqual(result.data, { hello: "world", n: 42 });
    const expectedHash = createHash("sha256").update(body).digest();
    assert.deepEqual(result.dataHash, expectedHash);
    assert.equal(result.source, server.url);
    assert.equal(result.paymentSignature, undefined);
  } finally {
    await server.close();
  }
});

test("apiKey upstream sends Authorization header from env var", async () => {
  process.env.TEST_API_KEY_VAR = "secret-token-xyz";
  const server = await withServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  try {
    await fetchData(
      server.url,
      {},
      { upstream: { kind: "apiKey", envVar: "TEST_API_KEY_VAR" } }
    );
    assert.equal(server.lastHeaders().authorization, "Bearer secret-token-xyz");
  } finally {
    delete process.env.TEST_API_KEY_VAR;
    await server.close();
  }
});

test("query params are appended to URL", async () => {
  let receivedUrl: string | undefined;
  const server = await withServer((req, res) => {
    receivedUrl = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  try {
    await fetchData(
      server.url,
      { lat: "40.0", lon: "29.0" },
      { upstream: { kind: "free" } }
    );
    assert.ok(receivedUrl?.includes("lat=40.0"));
    assert.ok(receivedUrl?.includes("lon=29.0"));
  } finally {
    await server.close();
  }
});

test("non-2xx upstream throws with status in message", async () => {
  const server = await withServer((_req, res) => {
    res.writeHead(503).end("upstream down");
  });
  try {
    await assert.rejects(
      () => fetchData(server.url, {}, { upstream: { kind: "free" } }),
      /HTTP 503/
    );
  } finally {
    await server.close();
  }
});

test("mpp upstream without signer throws clear error", async () => {
  await assert.rejects(
    () =>
      fetchData(
        "http://example.invalid/x",
        {},
        { upstream: { kind: "mpp", currency: "USDC" } }
      ),
    /no mppSigner/
  );
});

test("hash is byte-stable across param insertion order", async () => {
  const body = '{"some":"payload"}';
  const server = await withServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });
  try {
    const r1 = await fetchData(
      server.url,
      { a: "1", b: "2" },
      { upstream: { kind: "free" } }
    );
    const r2 = await fetchData(
      server.url,
      { b: "2", a: "1" },
      { upstream: { kind: "free" } }
    );
    assert.deepEqual(r1.dataHash, r2.dataHash);
  } finally {
    await server.close();
  }
});
