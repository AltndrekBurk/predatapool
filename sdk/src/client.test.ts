import test from "node:test";
import assert from "node:assert/strict";
import { PoolClient, type SubmitRequestInput } from "./client.js";

const BASE_INPUT: SubmitRequestInput = {
  endpoint: "https://api.weather.test/v1/current?lat=40&lon=29",
  params: {},
  buyerPubkey: "11111111111111111111111111111112",
  method: "GET",
  freshnessWindowSecs: 60,
  dataType: "weather",
};

function stubFetch(): {
  fn: typeof fetch;
  calls: number;
} {
  let calls = 0;
  const fn = (async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(
      JSON.stringify({
        poolHash: "deadbeef".repeat(8),
        status: "pending",
        buyerCount: 1,
        isNewPool: true,
        fetchTriggered: false,
        cacheHit: false,
        currentPriceUsdc: 100000,
        currentPriceFormatted: "$0.100000",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof fetch;
  return { fn, get calls() { return calls; } } as never;
}

test("PoolClient.submitRequest coalesces concurrent calls with identical key", async () => {
  const stub = stubFetch();
  const client = new PoolClient({ baseUrl: "http://localhost:3001", fetchImpl: stub.fn });

  const results = await Promise.all([
    client.submitRequest(BASE_INPUT),
    client.submitRequest(BASE_INPUT),
    client.submitRequest(BASE_INPUT),
    client.submitRequest(BASE_INPUT),
    client.submitRequest(BASE_INPUT),
  ]);

  assert.equal(stub.calls, 1, "fetchImpl invoked exactly once for 5 concurrent identical calls");
  assert.equal(results.length, 5);
  for (const r of results) assert.equal(r.isNewPool, true);
});

test("PoolClient.submitRequest does NOT coalesce different buyers", async () => {
  const stub = stubFetch();
  const client = new PoolClient({ baseUrl: "http://localhost:3001", fetchImpl: stub.fn });

  await Promise.all([
    client.submitRequest({ ...BASE_INPUT, buyerPubkey: "11111111111111111111111111111112" }),
    client.submitRequest({ ...BASE_INPUT, buyerPubkey: "So11111111111111111111111111111111111111112" }),
  ]);

  assert.equal(stub.calls, 2, "different buyerPubkey → two independent fetches");
});

test("PoolClient.submitRequest serial retries are independent", async () => {
  const stub = stubFetch();
  const client = new PoolClient({ baseUrl: "http://localhost:3001", fetchImpl: stub.fn });

  await client.submitRequest(BASE_INPUT);
  await client.submitRequest(BASE_INPUT);

  assert.equal(stub.calls, 2, "serial calls do not coalesce after the first settles");
});

test("PoolClient.submitRequest rejection propagates and clears entry", async () => {
  let calls = 0;
  const fn = (async () => {
    calls += 1;
    return new Response("{}", { status: 500, statusText: "boom" });
  }) as unknown as typeof fetch;
  const client = new PoolClient({ baseUrl: "http://localhost:3001", fetchImpl: fn });

  await assert.rejects(
    Promise.all([client.submitRequest(BASE_INPUT), client.submitRequest(BASE_INPUT)]),
    /POST \/request failed: 500/
  );
  assert.equal(calls, 1, "rejected fetch shared across awaiters");

  // After settle, a fresh attempt is independent
  await assert.rejects(client.submitRequest(BASE_INPUT), /500/);
  assert.equal(calls, 2);
});
