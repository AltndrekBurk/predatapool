import test from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  buildDataEnvelopeV0,
  verifyDataEnvelopeV0,
  envelopeRoot,
  type KeeperKey,
} from "./envelope.js";

function fixtureKeeper(): KeeperKey {
  const seed = new Uint8Array(32).fill(7);
  return { secretKey: seed, publicKey: ed25519.getPublicKey(seed) };
}

test("envelopeRoot is deterministic", () => {
  const a = envelopeRoot({
    payload: new TextEncoder().encode("hello"),
    sourceUrl: "https://example.com/data",
    fetchedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
  });
  const b = envelopeRoot({
    payload: new TextEncoder().encode("hello"),
    sourceUrl: "https://example.com/data",
    fetchedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
  });
  assert.deepEqual(a, b);
  assert.equal(a.length, 32);
});

test("buildDataEnvelopeV0 + verifyDataEnvelopeV0 succeed on fresh envelope", () => {
  const keeper = fixtureKeeper();
  const payload = new TextEncoder().encode('{"temp":18}');
  const now = Date.now();
  const env = buildDataEnvelopeV0({
    payload,
    sourceUrl: "https://api.weather.test/now",
    fetchedAt: now,
    expiresAt: now + 60_000,
    keeper,
  });
  assert.equal(env.version, 0);
  assert.deepEqual(
    verifyDataEnvelopeV0({
      payload,
      envelope: env,
      keeperPubkey: keeper.publicKey,
      now,
    }),
    true
  );
});

test("verifyDataEnvelopeV0 rejects tampered payload", () => {
  const keeper = fixtureKeeper();
  const payload = new TextEncoder().encode("original");
  const now = Date.now();
  const env = buildDataEnvelopeV0({
    payload,
    sourceUrl: "https://x.test",
    fetchedAt: now,
    expiresAt: now + 60_000,
    keeper,
  });
  const tampered = new TextEncoder().encode("tampered");
  assert.equal(
    verifyDataEnvelopeV0({
      payload: tampered,
      envelope: env,
      keeperPubkey: keeper.publicKey,
      now,
    }),
    false
  );
});

test("verifyDataEnvelopeV0 rejects expired envelope", () => {
  const keeper = fixtureKeeper();
  const payload = new TextEncoder().encode("x");
  const now = 1_700_000_000_000;
  const env = buildDataEnvelopeV0({
    payload,
    sourceUrl: "https://x.test",
    fetchedAt: now,
    expiresAt: now + 1000,
    keeper,
  });
  assert.equal(
    verifyDataEnvelopeV0({
      payload,
      envelope: env,
      keeperPubkey: keeper.publicKey,
      now: now + 5000,
    }),
    false
  );
});
