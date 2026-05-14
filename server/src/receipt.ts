/**
 * JoinReceipt — server-side adapter over `@predatapool/sdk`'s receipt.
 *
 * The SDK keeps the canonical 104-byte wire form pure (uses `@solana/kit`
 * `Address` strings). Server code wants `PublicKey` for keeper / Anchor
 * interop, so we adapt at the boundary.
 *
 * Wire format is byte-identical — the buyer signs the SDK's canonical bytes,
 * the server's Ed25519 verify checks the same trailing 104 bytes.
 */

import { PublicKey } from "@solana/web3.js";
import {
  RECEIPT_BYTES,
  RECEIPT_DOMAIN,
  RECEIPT_DOMAIN_LEN,
  serializeReceipt as serializeReceiptSdk,
  isReceiptFresh as isReceiptFreshSdk,
  type JoinReceipt as SdkJoinReceipt,
} from "@predatapool/sdk";
import type { Address } from "@solana/kit";

export { RECEIPT_BYTES, RECEIPT_DOMAIN, RECEIPT_DOMAIN_LEN };

export interface JoinReceipt {
  poolHash: Uint8Array;
  buyer: PublicKey;
  maxPrice: bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface SignedReceipt {
  receipt: JoinReceipt;
  signature: Uint8Array;
}

function toSdkReceipt(r: JoinReceipt): SdkJoinReceipt {
  return {
    poolHash: r.poolHash,
    buyer: r.buyer.toBase58() as Address,
    maxPrice: r.maxPrice,
    nonce: r.nonce,
    deadline: r.deadline,
  };
}

export function serializeReceipt(r: JoinReceipt): Uint8Array {
  return serializeReceiptSdk(toSdkReceipt(r));
}

export function isReceiptFresh(
  r: JoinReceipt,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  return isReceiptFreshSdk(toSdkReceipt(r), nowSec);
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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    poolHash: bytes.slice(16, 48),
    buyer: new PublicKey(bytes.slice(48, 80)),
    maxPrice: view.getBigUint64(80, true),
    nonce: view.getBigUint64(88, true),
    deadline: view.getBigInt64(96, true),
  };
}
