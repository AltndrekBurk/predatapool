/**
 * JoinReceipt — off-chain signed message authorizing the protocol to debit
 * a buyer's pre-approved USDC allowance into a specific pool.
 *
 * MUST stay byte-identical to server/src/receipt.ts. Both sides serialize
 * the same wire format; the buyer signs it client-side with Ed25519 (via
 * the wallet's signMessage feature) and the server forwards the signature
 * + receipt to the on-chain settle_batch instruction.
 *
 * Canonical wire format (104 bytes, little-endian):
 *   [0..16]   domain prefix "DATAPOOL_JOIN_V1"
 *   [16..48]  pool_hash       32 bytes
 *   [48..80]  buyer pubkey    32 bytes
 *   [80..88]  max_price       u64 LE
 *   [88..96]  nonce           u64 LE
 *   [96..104] deadline        i64 LE (unix seconds)
 */

import { getAddressEncoder, type Address } from "@solana/kit";

export const RECEIPT_DOMAIN = "DATAPOOL_JOIN_V1";
export const RECEIPT_DOMAIN_LEN = 16;
export const RECEIPT_BYTES = 104;

export interface JoinReceipt {
  poolHash: Uint8Array; // 32 bytes
  buyer: Address;
  maxPrice: bigint;
  nonce: bigint;
  deadline: bigint;
}

const addressEncoder = getAddressEncoder();

export function serializeReceipt(r: JoinReceipt): Uint8Array {
  if (r.poolHash.length !== 32) {
    throw new Error(`poolHash must be 32 bytes, got ${r.poolHash.length}`);
  }

  const buf = new Uint8Array(RECEIPT_BYTES);
  const view = new DataView(buf.buffer);

  const domainBytes = new TextEncoder().encode(RECEIPT_DOMAIN);
  buf.set(domainBytes, 0);

  buf.set(r.poolHash, 16);

  const buyerBytes = addressEncoder.encode(r.buyer);
  buf.set(buyerBytes, 48);

  view.setBigUint64(80, r.maxPrice, true);
  view.setBigUint64(88, r.nonce, true);
  view.setBigInt64(96, r.deadline, true);

  return buf;
}

export function hexFromBytes(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("hex must have even length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
