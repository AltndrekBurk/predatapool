import { test } from "node:test";
import assert from "node:assert/strict";
import { PoolStore, type PoolRecord } from "./store.js";

function makePool(overrides: Partial<PoolRecord> = {}): PoolRecord {
  return {
    requestHashHex: "a".repeat(64),
    endpoint: "http://x.test/y",
    params: { lat: "1" },
    providerId: "11111111111111111111111111111111",
    method: "GET",
    freshnessWindowSecs: 60,
    buyers: [],
    createdAt: 1_000_000,
    status: "pending",
    minBuyers: 2,
    fetchedAt: undefined,
    dataHash: undefined,
    expiresAt: undefined,
    ...overrides,
  };
}

test("insertPool + getPool roundtrip", () => {
  const store = new PoolStore(":memory:");
  const p = makePool({ buyers: ["B1"] });
  store.insertPool(p);
  const got = store.getPool(p.requestHashHex);
  assert.deepEqual(got, p);
  store.close();
});

test("addBuyer dedups and returns false on duplicate", () => {
  const store = new PoolStore(":memory:");
  const p = makePool();
  store.insertPool(p);
  assert.equal(store.addBuyer(p.requestHashHex, "B1"), true);
  assert.equal(store.addBuyer(p.requestHashHex, "B1"), false);
  assert.equal(store.addBuyer(p.requestHashHex, "B2"), true);
  const got = store.getPool(p.requestHashHex);
  assert.deepEqual(got?.buyers, ["B1", "B2"]);
  store.close();
});

test("recordFetched flips status and sets TTL", () => {
  const store = new PoolStore(":memory:");
  const p = makePool();
  store.insertPool(p);
  store.recordFetched(p.requestHashHex, "deadbeef", 2_000_000, 2_060_000);
  const got = store.getPool(p.requestHashHex);
  assert.equal(got?.status, "fetched");
  assert.equal(got?.fetchedAt, 2_000_000);
  assert.equal(got?.dataHash, "deadbeef");
  assert.equal(got?.expiresAt, 2_060_000);
  store.close();
});

test("upsertPool replaces a stale pool and CASCADEs payload", () => {
  const store = new PoolStore(":memory:");
  const p = makePool();
  store.insertPool(p);
  store.putPayload({
    requestHashHex: p.requestHashHex,
    body: Buffer.from("first"),
    contentType: "application/json",
    fetchedAt: 1,
    expiresAt: 100,
  });

  const replacement = makePool({ createdAt: 9_999_999 });
  store.upsertPool(replacement);

  const pool = store.getPool(replacement.requestHashHex);
  assert.equal(pool?.createdAt, 9_999_999);
  // payload should have CASCADEd away
  const payload = store.getPayload(replacement.requestHashHex);
  assert.equal(payload, undefined);
  store.close();
});

test("putPayload + getPayload roundtrip with binary body", () => {
  const store = new PoolStore(":memory:");
  store.insertPool(makePool());
  const body = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
  store.putPayload({
    requestHashHex: "a".repeat(64),
    body,
    contentType: "application/octet-stream",
    fetchedAt: 100,
    expiresAt: 200,
    paymentSignature: "siggy",
  });
  const got = store.getPayload("a".repeat(64));
  assert.deepEqual(got?.body, body);
  assert.equal(got?.contentType, "application/octet-stream");
  assert.equal(got?.paymentSignature, "siggy");
  store.close();
});

test("prune drops only expired entries", () => {
  const store = new PoolStore(":memory:");
  store.insertPool(
    makePool({
      requestHashHex: "a".repeat(64),
      status: "fetched",
      expiresAt: 100,
    })
  );
  store.insertPool(
    makePool({
      requestHashHex: "b".repeat(64),
      status: "fetched",
      expiresAt: 10_000,
    })
  );
  store.insertPool(
    makePool({
      requestHashHex: "c".repeat(64),
      status: "pending",
      expiresAt: undefined,
    })
  );
  store.putPayload({
    requestHashHex: "a".repeat(64),
    body: Buffer.from("x"),
    contentType: "x",
    fetchedAt: 1,
    expiresAt: 100,
  });
  store.putPayload({
    requestHashHex: "b".repeat(64),
    body: Buffer.from("y"),
    contentType: "y",
    fetchedAt: 1,
    expiresAt: 10_000,
  });

  const result = store.prune(5_000);
  assert.equal(result.pools, 1); // only "a"
  assert.equal(result.payloads, 1); // only "a"

  assert.equal(store.getPool("a".repeat(64)), undefined);
  assert.ok(store.getPool("b".repeat(64)));
  assert.ok(store.getPool("c".repeat(64))); // pending, no expires_at — kept
  store.close();
});
