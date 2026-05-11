import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  KEY_COMMITMENT_DOMAIN,
  POOL_KEY_BYTES,
  WRAPPED_KEY_BYTES,
  decryptPayload,
  ed25519PubToX25519Pub,
  encryptPayload,
  keyCommitment,
  newPoolKey,
  unwrapPoolKey,
  wrapPoolKey,
} from "./crypto.js";

const TEXT = new TextEncoder();

test("newPoolKey produces 32 bytes and is non-deterministic", () => {
  const a = newPoolKey();
  const b = newPoolKey();
  assert.equal(a.length, POOL_KEY_BYTES);
  assert.notDeepEqual(a, b);
});

test("encrypt → decrypt roundtrips an arbitrary payload", () => {
  const k = newPoolKey();
  const plaintext = TEXT.encode('{"some":"json","n":42}');
  const enc = encryptPayload(k, plaintext);
  assert.equal(enc.iv.length, 12);
  assert.notDeepEqual(enc.ciphertext, plaintext); // different bytes
  const back = decryptPayload(k, enc);
  assert.deepEqual(back, plaintext);
});

test("decrypt fails (throws) on wrong K_pool", () => {
  const k1 = newPoolKey();
  const k2 = newPoolKey();
  const enc = encryptPayload(k1, TEXT.encode("hello"));
  assert.throws(() => decryptPayload(k2, enc));
});

test("decrypt fails on tampered ciphertext (GCM auth tag)", () => {
  const k = newPoolKey();
  const enc = encryptPayload(k, TEXT.encode("hello world"));
  enc.ciphertext[0] ^= 0xff;
  assert.throws(() => decryptPayload(k, enc));
});

test("keyCommitment is deterministic and matches manual sha256", () => {
  const k = new Uint8Array(POOL_KEY_BYTES).fill(0xab);
  const c = keyCommitment(k);
  const expected = sha256(
    new Uint8Array([...KEY_COMMITMENT_DOMAIN, ...k])
  );
  assert.deepEqual(c, expected);
});

test("ECIES wrap → unwrap roundtrips K_pool", () => {
  const recipientSec = x25519.utils.randomSecretKey();
  const recipientPub = x25519.getPublicKey(recipientSec);
  const k = newPoolKey();
  const wrapped = wrapPoolKey(k, recipientPub);
  assert.equal(wrapped.length, WRAPPED_KEY_BYTES);
  const back = unwrapPoolKey(wrapped, recipientSec);
  assert.deepEqual(back, k);
});

test("each wrap of the same K_pool yields a different blob (fresh ephemeral)", () => {
  const recipientSec = x25519.utils.randomSecretKey();
  const recipientPub = x25519.getPublicKey(recipientSec);
  const k = newPoolKey();
  const w1 = wrapPoolKey(k, recipientPub);
  const w2 = wrapPoolKey(k, recipientPub);
  assert.notDeepEqual(w1, w2);
  // Both still decrypt to the same K_pool — that's what re-use means.
  assert.deepEqual(unwrapPoolKey(w1, recipientSec), k);
  assert.deepEqual(unwrapPoolKey(w2, recipientSec), k);
});

test("unwrap fails for the wrong recipient secret", () => {
  const aSec = x25519.utils.randomSecretKey();
  const aPub = x25519.getPublicKey(aSec);
  const bSec = x25519.utils.randomSecretKey();
  const k = newPoolKey();
  const wrapped = wrapPoolKey(k, aPub);
  assert.throws(() => unwrapPoolKey(wrapped, bSec));
});

test("ed25519 pub → x25519 pub conversion is deterministic", () => {
  // Pick an arbitrary 32-byte ed25519 pubkey-shaped buffer.
  // (Real Solana pubkeys are valid ed25519 points; for the conversion
  // function we just need 32 bytes — the curve helper handles it.)
  const ed = new Uint8Array(32).fill(0x01);
  const x1 = ed25519PubToX25519Pub(ed);
  const x2 = ed25519PubToX25519Pub(ed);
  assert.equal(x1.length, 32);
  assert.deepEqual(x1, x2);
});

test("end-to-end: encrypt + wrap → unwrap + decrypt", () => {
  // Simulates the protocol flow.
  const buyerSec = x25519.utils.randomSecretKey();
  const buyerPub = x25519.getPublicKey(buyerSec);

  const payload = TEXT.encode(JSON.stringify({ lat: 40, lon: 29, t: 21.5 }));

  // Server side
  const k = newPoolKey();
  const commitment = keyCommitment(k);
  const enc = encryptPayload(k, payload);
  const wrapped = wrapPoolKey(k, buyerPub);

  // Buyer side
  const kBack = unwrapPoolKey(wrapped, buyerSec);
  // Buyer verifies key commitment matches what's published on-chain.
  assert.deepEqual(keyCommitment(kBack), commitment);
  const back = decryptPayload(kBack, enc);
  assert.deepEqual(back, payload);
});
