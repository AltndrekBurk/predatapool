/**
 * JoinReceipt — off-chain signed message authorizing the protocol to debit
 * a buyer's pre-approved USDC allowance into a specific pool.
 *
 * Canonical wire format (104 bytes, little-endian):
 *   [0..16]   domain prefix "DATAPOOL_JOIN_V1"
 *   [16..48]  pool_hash       32 bytes
 *   [48..80]  buyer pubkey    32 bytes
 *   [80..88]  max_price       u64 LE
 *   [88..96]  nonce           u64 LE
 *   [96..104] deadline        i64 LE (unix seconds)
 *
 * The buyer signs this exact byte string with Ed25519. On-chain
 * `settle_receipt` verifies the signature via Solana's Ed25519 precompile.
 */

import { getAddressEncoder, type Address } from "@solana/kit";

export const RECEIPT_DOMAIN = "DATAPOOL_JOIN_V1";
export const RECEIPT_DOMAIN_LEN = 16;
export const RECEIPT_BYTES = 104;

export interface JoinReceipt {
  /** 32-byte canonical pool hash (`hashRequestV2` output). */
  poolHash: Uint8Array;
  /** Buyer wallet address (base58). */
  buyer: Address;
  /** Buyer-declared price ceiling in USDC micro-units. */
  maxPrice: bigint;
  /** Unique per (buyer, pool) — replay protection. */
  nonce: bigint;
  /** Unix seconds; receipt invalid after this. */
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
  if (domainBytes.length !== RECEIPT_DOMAIN_LEN) {
    throw new Error("receipt domain prefix must be exactly 16 bytes");
  }
  buf.set(domainBytes, 0);

  buf.set(r.poolHash, 16);

  const buyerBytes = addressEncoder.encode(r.buyer);
  buf.set(buyerBytes, 48);

  view.setBigUint64(80, r.maxPrice, true);
  view.setBigUint64(88, r.nonce, true);
  view.setBigInt64(96, r.deadline, true);

  return buf;
}

export function isReceiptFresh(
  r: JoinReceipt,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  return Number(r.deadline) >= nowSec;
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
