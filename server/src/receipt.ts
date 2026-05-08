/**
 * JoinReceipt — off-chain signed message authorizing the protocol to debit
 * a buyer's pre-approved USDC allowance into a specific pool.
 *
 * Canonical wire format (104 bytes, little-endian):
 *   [0..16]   domain prefix "DATAPOOL_JOIN_V1" (ASCII, no null)
 *   [16..48]  pool_hash       32 bytes
 *   [48..80]  buyer pubkey    32 bytes
 *   [80..88]  max_price       u64 LE
 *   [88..96]  nonce           u64 LE
 *   [96..104] deadline        i64 LE (unix seconds)
 *
 * The buyer signs this exact byte string with Ed25519. The on-chain
 * settle_batch instruction verifies via Solana's Ed25519 precompile, so the
 * server never needs to re-sign anything — it just aggregates receipts.
 *
 * The domain prefix is critical: without it a malicious counterparty could
 * trick a buyer into signing a message that's also valid in another protocol.
 */

import { PublicKey } from "@solana/web3.js";

export const RECEIPT_DOMAIN = "DATAPOOL_JOIN_V1";
export const RECEIPT_DOMAIN_LEN = 16;
export const RECEIPT_BYTES = 104;

export interface JoinReceipt {
  poolHash: Uint8Array; // 32 bytes
  buyer: PublicKey;
  maxPrice: bigint; // u64 — micro-USDC
  nonce: bigint; // u64 — unique per (buyer, pool)
  deadline: bigint; // i64 — unix seconds, receipt invalid after this
}

export interface SignedReceipt {
  receipt: JoinReceipt;
  signature: Uint8Array; // 64 bytes ed25519
}

export function serializeReceipt(r: JoinReceipt): Uint8Array {
  if (r.poolHash.length !== 32) {
    throw new Error(`poolHash must be 32 bytes, got ${r.poolHash.length}`);
  }

  const buf = new Uint8Array(RECEIPT_BYTES);
  const view = new DataView(buf.buffer);

  // Domain prefix
  const domainBytes = new TextEncoder().encode(RECEIPT_DOMAIN);
  if (domainBytes.length !== RECEIPT_DOMAIN_LEN) {
    throw new Error("domain prefix must be exactly 16 bytes");
  }
  buf.set(domainBytes, 0);

  // pool_hash
  buf.set(r.poolHash, 16);

  // buyer pubkey
  buf.set(r.buyer.toBytes(), 48);

  // max_price (u64 LE)
  view.setBigUint64(80, r.maxPrice, true);

  // nonce (u64 LE)
  view.setBigUint64(88, r.nonce, true);

  // deadline (i64 LE)
  view.setBigInt64(96, r.deadline, true);

  return buf;
}

export function deserializeReceipt(bytes: Uint8Array): JoinReceipt {
  if (bytes.length !== RECEIPT_BYTES) {
    throw new Error(`expected ${RECEIPT_BYTES} bytes, got ${bytes.length}`);
  }

  const decoder = new TextDecoder();
  const domain = decoder.decode(bytes.slice(0, RECEIPT_DOMAIN_LEN));
  if (domain !== RECEIPT_DOMAIN) {
    throw new Error(`domain mismatch: ${domain}`);
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );

  return {
    poolHash: bytes.slice(16, 48),
    buyer: new PublicKey(bytes.slice(48, 80)),
    maxPrice: view.getBigUint64(80, true),
    nonce: view.getBigUint64(88, true),
    deadline: view.getBigInt64(96, true),
  };
}

/**
 * Returns true if the receipt is currently valid (deadline not passed).
 * Stale receipts must be rejected by the server before they reach the chain
 * — the on-chain check is a backstop, not the primary gate.
 */
export function isReceiptFresh(r: JoinReceipt, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return Number(r.deadline) >= nowSec;
}
