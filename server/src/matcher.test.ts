/**
 * Tests for canonical request_key v2 hashing.
 * Run: `npm test` from /server (uses tsx + node:test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalRequest,
  buildPoolMetadata,
  hashRequestV2,
  joinPool,
  markFetched,
  markFetching,
  getPool,
  REQUEST_KEY_DOMAIN,
  type DataRequest,
  type RequestKeyInput,
} from "./matcher.js";
import {
  PoolStore,
  _setStoreForTests,
  type PayloadRecord,
  type PoolRecord,
} from "./store.js";

const PROVIDER_A = "11111111111111111111111111111111";
const PROVIDER_B = "So11111111111111111111111111111111111111112";

function baseInput(overrides: Partial<RequestKeyInput> = {}): RequestKeyInput {
  return {
    providerId: PROVIDER_A,
    method: "GET",
    endpoint: "https://api.weatherxm.com/v1/cells",
    params: { lat: "40.0", lon: "29.0" },
    freshnessWindowSecs: 60,
    ...overrides,
  };
}

test("domain prefix is versioned", () => {
  assert.equal(REQUEST_KEY_DOMAIN, "DATAPOOL_REQ_V2");
});

test("identical inputs produce identical 32-byte hashes", () => {
  const h1 = hashRequestV2(baseInput());
  const h2 = hashRequestV2(baseInput());
  assert.equal(h1.length, 32);
  assert.deepEqual(h1, h2);
});

test("param insertion order does not affect hash", () => {
  const h1 = hashRequestV2(baseInput({ params: { lat: "40.0", lon: "29.0" } }));
  const h2 = hashRequestV2(baseInput({ params: { lon: "29.0", lat: "40.0" } }));
  assert.deepEqual(h1, h2);
});

test("different provider yields different hash", () => {
  const h1 = hashRequestV2(baseInput({ providerId: PROVIDER_A }));
  const h2 = hashRequestV2(baseInput({ providerId: PROVIDER_B }));
  assert.notDeepEqual(h1, h2);
});

test("different method yields different hash", () => {
  const h1 = hashRequestV2(baseInput({ method: "GET" }));
  const h2 = hashRequestV2(baseInput({ method: "POST" }));
  assert.notDeepEqual(h1, h2);
});

test("method casing does not affect hash", () => {
  const h1 = hashRequestV2(baseInput({ method: "GET" }));
  const h2 = hashRequestV2(baseInput({ method: "get" }));
  const h3 = hashRequestV2(baseInput({ method: "  Get  " }));
  assert.deepEqual(h1, h2);
  assert.deepEqual(h1, h3);
});

test("different freshness window yields different hash", () => {
  const h1 = hashRequestV2(baseInput({ freshnessWindowSecs: 60 }));
  const h2 = hashRequestV2(baseInput({ freshnessWindowSecs: 3600 }));
  assert.notDeepEqual(h1, h2);
});

test("host casing and trailing slash do not affect hash", () => {
  const h1 = hashRequestV2(
    baseInput({ endpoint: "https://api.weatherxm.com/v1/cells" })
  );
  const h2 = hashRequestV2(
    baseInput({ endpoint: "https://API.WeatherXM.COM/v1/cells/" })
  );
  assert.deepEqual(h1, h2);
});

test("URL query string merges with explicit params (explicit wins)", () => {
  // URL query alone vs. equivalent explicit params → same key.
  const h1 = hashRequestV2(
    baseInput({
      endpoint: "https://api.weatherxm.com/v1/cells?lat=40.0&lon=29.0",
      params: {},
    })
  );
  const h2 = hashRequestV2(
    baseInput({
      endpoint: "https://api.weatherxm.com/v1/cells",
      params: { lat: "40.0", lon: "29.0" },
    })
  );
  assert.deepEqual(h1, h2);

  // Explicit param overrides URL query value.
  const h3 = hashRequestV2(
    baseInput({
      endpoint: "https://api.weatherxm.com/v1/cells?lat=99.9",
      params: { lat: "40.0", lon: "29.0" },
    })
  );
  assert.deepEqual(h1, h3);
});

test("different params yield different hash", () => {
  const h1 = hashRequestV2(baseInput({ params: { lat: "40.0", lon: "29.0" } }));
  const h2 = hashRequestV2(baseInput({ params: { lat: "40.0", lon: "30.0" } }));
  assert.notDeepEqual(h1, h2);
});

test("integer-like param keys are still order-stable", () => {
  // JS engines sometimes float "123" before string keys; stableStringify must defeat this.
  const h1 = hashRequestV2(baseInput({ params: { "1": "a", b: "x" } }));
  const h2 = hashRequestV2(baseInput({ params: { b: "x", "1": "a" } }));
  assert.deepEqual(h1, h2);
});

test("invalid freshness window is rejected", () => {
  assert.throws(() => buildCanonicalRequest(baseInput({ freshnessWindowSecs: 0 })));
  assert.throws(() => buildCanonicalRequest(baseInput({ freshnessWindowSecs: -1 })));
  assert.throws(() => buildCanonicalRequest(baseInput({ freshnessWindowSecs: 1.5 })));
});

test("missing providerId is rejected", () => {
  assert.throws(() => buildCanonicalRequest(baseInput({ providerId: "" })));
});

function freshStore() {
  _setStoreForTests(new PoolStore(":memory:"));
}

function baseJoin(overrides: Partial<DataRequest> = {}): DataRequest {
  return {
    providerId: PROVIDER_A,
    method: "GET",
    endpoint: "https://api.weatherxm.com/v1/cells",
    params: { lat: "40.0", lon: "29.0" },
    freshnessWindowSecs: 60,
    buyerPubkey: "buyer-1",
    maxPriceUsdc: 1_000_000,
    minBuyers: 2,
    ...overrides,
  };
}

test("joinPool — first buyer creates pool with isNewPool=true", () => {
  freshStore();
  const r = joinPool(baseJoin());
  assert.equal(r.isNewPool, true);
  assert.equal(r.cacheHit, false);
  assert.equal(r.pool.status, "pending");
  assert.deepEqual(r.pool.buyers, ["buyer-1"]);
});

test("joinPool — second buyer same key reuses pending pool", () => {
  freshStore();
  joinPool(baseJoin({ buyerPubkey: "buyer-1", minBuyers: 5 }));
  const r2 = joinPool(baseJoin({ buyerPubkey: "buyer-2", minBuyers: 5 }));
  assert.equal(r2.isNewPool, false);
  assert.equal(r2.pool.buyers.length, 2);
});

test("joinPool — fetched + still fresh = cache hit, no new pool", () => {
  freshStore();
  const first = joinPool(baseJoin());
  markFetching(first.pool.requestHashHex);
  markFetched(first.pool.requestHashHex, "deadbeef");

  const second = joinPool(baseJoin({ buyerPubkey: "buyer-2" }));
  assert.equal(second.isNewPool, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.pool.status, "fetched");
  assert.equal(second.pool.dataHash, "deadbeef");
});

test("joinPool — fetched + expired = new pool, dataHash cleared", () => {
  freshStore();
  const first = joinPool(baseJoin({ freshnessWindowSecs: 1 }));
  markFetched(first.pool.requestHashHex, "deadbeef");
  // Wait past the 1s freshness window.
  const stale = getPool(first.pool.requestHashHex);
  assert.ok(stale?.expiresAt && stale.expiresAt > 0);
  // Force expiry by manipulating time via a very small TTL pool state.
  // We can't easily fake time without injecting clocks, so insert a fake
  // expired pool directly via the store.
  const future = stale.expiresAt + 1_000_000;
  const orig = Date.now;
  Date.now = () => future;
  try {
    const second = joinPool(baseJoin({ buyerPubkey: "buyer-2", freshnessWindowSecs: 1 }));
    assert.equal(second.isNewPool, true);
    assert.equal(second.cacheHit, false);
    assert.equal(second.pool.dataHash, undefined);
    assert.equal(second.pool.status, "pending");
  } finally {
    Date.now = orig;
  }
});

test("buildPoolMetadata — pending pool exposes inputs but no fetch fields", () => {
  const pool: PoolRecord = {
    requestHashHex: "ab".repeat(32),
    endpoint: "https://api.weatherxm.com/v1/cells",
    params: { lat: "40.0" },
    providerId: PROVIDER_A,
    method: "GET",
    freshnessWindowSecs: 60,
    buyers: ["buyer-1"],
    authorizedBuyers: [],
    createdAt: 1_000_000,
    status: "pending",
    minBuyers: 2,
  };
  const meta = buildPoolMetadata(pool, undefined, "https://srv");
  assert.equal(meta.v, 2);
  assert.equal(meta.status, "pending");
  assert.equal(meta.cacheHit, false);
  assert.equal(meta.providerId, PROVIDER_A);
  assert.equal(meta.endpoint, pool.endpoint);
  assert.equal(meta.buyerCount, 1);
  assert.equal(meta.dataHash, undefined);
  assert.equal(meta.storageUri, undefined);
  assert.equal(meta.payloadUrl, undefined);
  assert.equal(meta.paymentSignature, undefined);
});

test("buildPoolMetadata — fetched + fresh pool advertises storageUri and cacheHit=true", () => {
  const now = 5_000;
  const pool: PoolRecord = {
    requestHashHex: "cd".repeat(32),
    endpoint: "https://api.weatherxm.com/v1/cells",
    params: { lat: "40.0" },
    providerId: PROVIDER_A,
    method: "GET",
    freshnessWindowSecs: 60,
    buyers: ["b1", "b2"],
    authorizedBuyers: ["b1"],
    createdAt: 1_000,
    fetchedAt: 2_000,
    dataHash: "deadbeef",
    expiresAt: 6_000,
    status: "fetched",
    minBuyers: 2,
  };
  const payload: PayloadRecord = {
    requestHashHex: pool.requestHashHex,
    ciphertext: Buffer.from('{"x":1}'),
    iv: Buffer.alloc(12, 0xaa),
    poolKey: Buffer.alloc(32, 0xbb),
    keyCommitment: Buffer.alloc(32, 0xcc),
    envelopeVersion: 0,
    sourceUrl: "https://api.weatherxm.com/v1/cells",
    sourceHash: Buffer.alloc(32, 0xdd),
    merkleRoot: Buffer.alloc(32, 0xee),
    keeperPubkey: Buffer.alloc(32, 0x11),
    keeperSignature: Buffer.alloc(64, 0xff),
    contentType: "application/json",
    fetchedAt: 2_000,
    expiresAt: 6_000,
    paymentSignature: "sigsigsig",
  };
  const meta = buildPoolMetadata(pool, payload, "https://srv", now);
  assert.equal(meta.cacheHit, true);
  assert.equal(meta.dataHash, "deadbeef");
  assert.equal(meta.storageUri, `https://srv/pool/${pool.requestHashHex}/payload`);
  assert.equal(meta.payloadUrl, `https://srv/pool/${pool.requestHashHex}/payload`);
  assert.equal(meta.envelope?.version, 0);
  assert.equal(meta.envelope?.sourceUrl, "https://api.weatherxm.com/v1/cells");
  assert.equal(meta.envelope?.merkleRoot, "ee".repeat(32));
  assert.equal(meta.paymentSignature, "sigsigsig");
});

test("buildPoolMetadata — fetched + expired pool reports cacheHit=false", () => {
  const now = 9_999;
  const pool: PoolRecord = {
    requestHashHex: "ef".repeat(32),
    endpoint: "https://api.weatherxm.com/v1/cells",
    params: {},
    providerId: PROVIDER_A,
    method: "GET",
    freshnessWindowSecs: 60,
    buyers: [],
    authorizedBuyers: [],
    createdAt: 1_000,
    fetchedAt: 2_000,
    dataHash: "abc",
    expiresAt: 5_000, // expired
    status: "fetched",
    minBuyers: 1,
  };
  const meta = buildPoolMetadata(pool, undefined, "https://srv", now);
  assert.equal(meta.cacheHit, false);
  // storageUri still exposed when fetched (even past expiry) so on-chain
  // historical reads can still resolve to a *served-while-cached* URL.
  assert.equal(
    meta.storageUri,
    `https://srv/pool/${pool.requestHashHex}/payload`
  );
});

test("canonical form is exposed for audits", () => {
  const canon = buildCanonicalRequest(
    baseInput({
      endpoint: "https://API.weatherxm.com/v1/cells/?lat=40.0",
      params: { lon: "29.0" },
      method: "get",
    })
  );
  assert.equal(canon.v, 2);
  assert.equal(canon.provider, PROVIDER_A);
  assert.equal(canon.method, "GET");
  assert.equal(canon.path, "api.weatherxm.com/v1/cells");
  assert.deepEqual(canon.params, { lat: "40.0", lon: "29.0" });
  assert.equal(canon.freshness_window_secs, 60);
});
