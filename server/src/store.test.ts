import { test } from "node:test";
import assert from "node:assert/strict";
import { PoolStore, type PayloadRecord, type PoolRecord } from "./store.js";

/**
 * Build a synthetic ciphertext-shaped PayloadRecord. Tests of the storage
 * layer don't care about real crypto — only that bytes round-trip and the
 * schema accepts the right column shapes.
 */
function makePayload(
  hashHex: string,
  bodyBytes: Buffer,
  overrides: Partial<PayloadRecord> = {}
): PayloadRecord {
  return {
    requestHashHex: hashHex,
    ciphertext: bodyBytes,
    iv: Buffer.alloc(12, 0xaa),
    poolKey: Buffer.alloc(32, 0xbb),
    keyCommitment: Buffer.alloc(32, 0xcc),
    envelopeVersion: 0,
    sourceUrl: "http://x.test/y",
    sourceHash: Buffer.alloc(32, 0xdd),
    merkleRoot: Buffer.alloc(32, 0xee),
    keeperPubkey: Buffer.alloc(32, 0x11),
    keeperSignature: Buffer.alloc(64, 0xff),
    contentType: "application/json",
    fetchedAt: 1,
    expiresAt: 100,
    ...overrides,
  };
}

function makePool(overrides: Partial<PoolRecord> = {}): PoolRecord {
  return {
    requestHashHex: "a".repeat(64),
    endpoint: "http://x.test/y",
    params: { lat: "1" },
    providerId: "11111111111111111111111111111111",
    method: "GET",
    freshnessWindowSecs: 60,
    buyers: [],
    authorizedBuyers: [],
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

test("addAuthorizedBuyer dedups receipt-authorized buyers", () => {
  const store = new PoolStore(":memory:");
  const p = makePool();
  store.insertPool(p);
  assert.equal(store.addAuthorizedBuyer(p.requestHashHex, "B1"), true);
  assert.equal(store.addAuthorizedBuyer(p.requestHashHex, "B1"), false);
  const got = store.getPool(p.requestHashHex);
  assert.deepEqual(got?.authorizedBuyers, ["B1"]);
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
  store.putPayload(makePayload(p.requestHashHex, Buffer.from("first")));

  const replacement = makePool({ createdAt: 9_999_999 });
  store.upsertPool(replacement);

  const pool = store.getPool(replacement.requestHashHex);
  assert.equal(pool?.createdAt, 9_999_999);
  // payload should have CASCADEd away
  const payload = store.getPayload(replacement.requestHashHex);
  assert.equal(payload, undefined);
  store.close();
});

test("putPayload + getPayload roundtrip with binary ciphertext", () => {
  const store = new PoolStore(":memory:");
  store.insertPool(makePool());
  const ct = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
  store.putPayload(
    makePayload("a".repeat(64), ct, {
      contentType: "application/octet-stream",
      fetchedAt: 100,
      expiresAt: 200,
      paymentSignature: "siggy",
    })
  );
  const got = store.getPayload("a".repeat(64));
  assert.deepEqual(got?.ciphertext, ct);
  assert.equal(got?.iv.length, 12);
  assert.equal(got?.poolKey.length, 32);
  assert.equal(got?.keyCommitment.length, 32);
  assert.equal(got?.envelopeVersion, 0);
  assert.equal(got?.sourceUrl, "http://x.test/y");
  assert.equal(got?.sourceHash.length, 32);
  assert.equal(got?.merkleRoot.length, 32);
  assert.equal(got?.keeperPubkey.length, 32);
  assert.equal(got?.keeperSignature.length, 64);
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
  store.putPayload(
    makePayload("a".repeat(64), Buffer.from("x"), {
      contentType: "x",
      fetchedAt: 1,
      expiresAt: 100,
    })
  );
  store.putPayload(
    makePayload("b".repeat(64), Buffer.from("y"), {
      contentType: "y",
      fetchedAt: 1,
      expiresAt: 10_000,
    })
  );

  const result = store.prune(5_000);
  assert.equal(result.pools, 1); // only "a"
  assert.equal(result.payloads, 1); // only "a"

  assert.equal(store.getPool("a".repeat(64)), undefined);
  assert.ok(store.getPool("b".repeat(64)));
  assert.ok(store.getPool("c".repeat(64))); // pending, no expires_at — kept
  store.close();
});
