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

