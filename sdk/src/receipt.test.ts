import test from "node:test";
import assert from "node:assert/strict";
import { address } from "@solana/kit";
import {
  RECEIPT_BYTES,
  RECEIPT_DOMAIN,
  RECEIPT_DOMAIN_LEN,
  serializeReceipt,
  hexFromBytes,
  bytesFromHex,
  isReceiptFresh,
} from "./receipt.js";

const FIXED_BUYER = address("11111111111111111111111111111112");

test("serializeReceipt: length, domain prefix, pool_hash slot", () => {
  const poolHash = new Uint8Array(32).fill(0xab);
  const bytes = serializeReceipt({
    poolHash,
    buyer: FIXED_BUYER,
    maxPrice: 1_000_000n,
    nonce: 42n,
    deadline: 2_000_000_000n,
  });
  assert.equal(bytes.length, RECEIPT_BYTES);
  const dom = new TextDecoder().decode(bytes.slice(0, RECEIPT_DOMAIN_LEN));
  assert.equal(dom, RECEIPT_DOMAIN);
  assert.deepEqual(bytes.slice(16, 48), poolHash);
});

test("serializeReceipt: little-endian numeric fields", () => {
  const bytes = serializeReceipt({
    poolHash: new Uint8Array(32),
    buyer: FIXED_BUYER,
    maxPrice: 0x0807060504030201n,
    nonce: 0x1112131415161718n,
    deadline: 0x2122232425262728n,
  });
  // max_price at 80..88, LE
  assert.deepEqual(
    Array.from(bytes.slice(80, 88)),
    [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
  );
  // nonce at 88..96, LE
  assert.deepEqual(
    Array.from(bytes.slice(88, 96)),
    [0x18, 0x17, 0x16, 0x15, 0x14, 0x13, 0x12, 0x11]
  );
  // deadline at 96..104, LE
  assert.deepEqual(
    Array.from(bytes.slice(96, 104)),
    [0x28, 0x27, 0x26, 0x25, 0x24, 0x23, 0x22, 0x21]
  );
});

test("serializeReceipt: rejects non-32-byte poolHash", () => {
  assert.throws(() =>
    serializeReceipt({
      poolHash: new Uint8Array(31),
      buyer: FIXED_BUYER,
      maxPrice: 0n,
      nonce: 0n,
      deadline: 0n,
    })
  );
});

test("serializeReceipt: deterministic for identical inputs", () => {
  const a = serializeReceipt({
    poolHash: new Uint8Array(32).fill(7),
    buyer: FIXED_BUYER,
    maxPrice: 1n,
    nonce: 2n,
    deadline: 3n,
  });
  const b = serializeReceipt({
    poolHash: new Uint8Array(32).fill(7),
    buyer: FIXED_BUYER,
    maxPrice: 1n,
    nonce: 2n,
    deadline: 3n,
  });
  assert.deepEqual(a, b);
});

test("hex helpers round-trip", () => {
  const raw = new Uint8Array([0, 1, 2, 254, 255]);
  const hex = hexFromBytes(raw);
  assert.equal(hex, "000102feff");
  assert.deepEqual(bytesFromHex(hex), raw);
  assert.deepEqual(bytesFromHex("0x" + hex), raw);
  assert.throws(() => bytesFromHex("abc"));
});

test("isReceiptFresh", () => {
  const now = 1_700_000_000;
  assert.equal(
    isReceiptFresh(
      {
        poolHash: new Uint8Array(32),
        buyer: FIXED_BUYER,
        maxPrice: 0n,
        nonce: 0n,
        deadline: BigInt(now + 60),
      },
      now
    ),
    true
  );
  assert.equal(
    isReceiptFresh(
      {
        poolHash: new Uint8Array(32),
        buyer: FIXED_BUYER,
        maxPrice: 0n,
        nonce: 0n,
        deadline: BigInt(now - 1),
      },
      now
    ),
    false
  );
});
