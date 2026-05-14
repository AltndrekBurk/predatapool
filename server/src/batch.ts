/**
 * Batched receipt accumulator.
 *
 * Buyers POST signed JoinReceipts off-chain. We validate them here and
 * stash them in a per-pool queue. A scheduler later drains each queue
 * and submits a single on-chain `settle_batch` instruction that pulls
 * USDC from each buyer's pre-approved allowance and records the joins.
 *
 * The energy savings vs. per-buyer on-chain joins:
 *   - N buyer signatures (off-chain, free) instead of N transactions
 *   - 1 settle_batch tx with N Ed25519-precompile verifications (cheap)
 *   - 1 batched USDC pull with N delegated transfers
 *
 * Pool existence is lazy: the first valid receipt for a pool_hash creates
 * it. The on-chain DataPool is initialized in parallel by the keeper
 * (see initializePoolOnChain) so settle_batch has a target to write into.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import {
  serializeReceipt,
  isReceiptFresh,
  type JoinReceipt,
  type SignedReceipt,
  RECEIPT_BYTES,
} from "./receipt.js";

export interface PendingReceipt {
  receipt: JoinReceipt;
  signedMessage: Uint8Array;
  signature: Uint8Array;
  receivedAt: number;
}

const MAX_BATCH_SIZE = 64;
const RECEIPT_GRACE_SECONDS = 30; // server clock may differ slightly from client

/**
 * Per-pool queue of pending receipts waiting for the next settlement batch.
 * Keyed by pool_hash hex.
 */
const pendingByPool = new Map<string, PendingReceipt[]>();

/**
 * Per-(buyer, pool_hash) used nonces — replay protection on the server side.
 * On-chain protection happens via per-buyer nonce-set in settle_batch.
 */
const usedNonces = new Map<string, Set<string>>(); // key: `${poolHashHex}:${buyer}`

function nonceKey(poolHashHex: string, buyer: string): string {
  return `${poolHashHex}:${buyer}`;
}

export interface AcceptReceiptResult {
  poolHashHex: string;
  batchSize: number;
  reused: boolean;
}

export class ReceiptError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ReceiptError";
  }
}

/**
 * Validate and enqueue a signed receipt.
 *
 * Throws ReceiptError on any validation failure — caller should map to 4xx.
 */
export function acceptReceipt(input: {
  receipt: JoinReceipt;
  signedMessage: Uint8Array;
  signature: Uint8Array;
}): AcceptReceiptResult {
  const { receipt, signedMessage, signature } = input;

  // 1. Signature shape
  if (signature.length !== 64) {
    throw new ReceiptError("BAD_SIG", `signature must be 64 bytes, got ${signature.length}`);
  }
  if (signedMessage.length < RECEIPT_BYTES) {
    throw new ReceiptError(
      "BAD_MSG",
      `signedMessage too short: ${signedMessage.length} < ${RECEIPT_BYTES}`
    );
  }

  // 2. Reconstruct expected canonical bytes from receipt fields, then check
  //    that signedMessage either equals it OR contains it as suffix.
  //    (Some wallets prepend a domain prefix — we tolerate any prefix as
  //    long as the trailing 104 bytes are our canonical form.)
  const expected = serializeReceipt(receipt);
  const trailing = signedMessage.slice(signedMessage.length - RECEIPT_BYTES);
  if (!buffersEqual(trailing, expected)) {
    throw new ReceiptError(
      "MSG_MISMATCH",
      "signedMessage does not match receipt fields"
    );
  }

  // 3. Freshness
  if (!isReceiptFresh(receipt)) {
    const now = Math.floor(Date.now() / 1000);
    throw new ReceiptError(
      "EXPIRED",
      `receipt deadline ${receipt.deadline} < now ${now}`
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(receipt.deadline) - nowSec > 3600) {
    throw new ReceiptError("DEADLINE_TOO_FAR", "deadline > 1h in the future");
  }

  // 4. Ed25519 verify against the actual signed bytes (not our reconstruction).
  //    Pubkey is the buyer's address — same key the wallet derived from.
  const pubkeyBytes = receipt.buyer.toBytes();
  let valid = false;
  try {
    valid = ed25519.verify(signature, signedMessage, pubkeyBytes);
  } catch (e) {
    throw new ReceiptError("VERIFY_THREW", `verify error: ${(e as Error).message}`);
  }
  if (!valid) {
    throw new ReceiptError("INVALID_SIG", "ed25519 verification failed");
  }

  // 5. Nonce replay
  const poolHashHex = Buffer.from(receipt.poolHash).toString("hex");
  const buyerStr = receipt.buyer.toBase58();
  const key = nonceKey(poolHashHex, buyerStr);
  let used = usedNonces.get(key);
  if (!used) {
    used = new Set();
    usedNonces.set(key, used);
  }
  const nonceStr = receipt.nonce.toString();
  if (used.has(nonceStr)) {
    return {
      poolHashHex,
      batchSize: pendingByPool.get(poolHashHex)?.length ?? 0,
      reused: true,
    };
  }
  used.add(nonceStr);

  // 6. Enqueue
  let batch = pendingByPool.get(poolHashHex);
  if (!batch) {
    batch = [];
    pendingByPool.set(poolHashHex, batch);
  }
  if (batch.length >= MAX_BATCH_SIZE) {
    throw new ReceiptError("BATCH_FULL", `pool batch full (${MAX_BATCH_SIZE})`);
  }
  batch.push({
    receipt,
    signedMessage,
    signature,
    receivedAt: Date.now(),
  });

  return { poolHashHex, batchSize: batch.length, reused: false };
}

export function getPendingBatch(poolHashHex: string): PendingReceipt[] {
  return pendingByPool.get(poolHashHex) ?? [];
}

/**
 * Atomically remove and return the current batch for a pool. Used by the
 * settlement scheduler — after this returns, new receipts go into a fresh
 * batch.
 */
export function drainBatch(poolHashHex: string): PendingReceipt[] {
  const batch = pendingByPool.get(poolHashHex);
  if (!batch || batch.length === 0) return [];
  pendingByPool.delete(poolHashHex);
  return batch;
}

export function listPoolsWithPending(): string[] {
  return Array.from(pendingByPool.entries())
    .filter(([, batch]) => batch.length > 0)
    .map(([k]) => k);
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Re-export Buffer-compatible helpers for the http layer that lives elsewhere.
export type { JoinReceipt, SignedReceipt };
