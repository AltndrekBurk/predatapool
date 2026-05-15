/**
 * Background scheduler — settlement + cache prune + crash recovery.
 *
 * Extracted from `index.ts` so the HTTP server stays focused on routes.
 * No HTTP coupling here: schedulers only touch the store and the keeper.
 */

import { drainBatch, listPoolsWithPending } from "./batch.js";
import { settleReceiptOnChain } from "./keeper.js";
import { getStore } from "./store.js";

export const SETTLE_INTERVAL_MS = Number(
  process.env.SETTLE_INTERVAL_MS ?? 5000
);
export const PRUNE_INTERVAL_MS = Number(
  process.env.PRUNE_INTERVAL_MS ?? 30_000
);

const settling = new Set<string>();

/**
 * Drain pending receipts for each pool and submit each as a single
 * `settle_receipt` transaction. One in-flight settlement per pool prevents
 * nonce races between concurrent settles targeting the same buyer.
 *
 * On settle success, the buyer is added to `authorizedBuyers` — this gates
 * the `/pool/:hash/key` endpoint so an attacker cannot get K_pool by simply
 * POSTing a signed receipt; they must also have an on-chain BuyerSlot.
 */
export async function tickSettle(): Promise<void> {
  const pools = listPoolsWithPending();
  for (const poolHashHex of pools) {
    if (settling.has(poolHashHex)) continue;
    settling.add(poolHashHex);

    void (async () => {
      try {
        const receipts = drainBatch(poolHashHex);
        for (const r of receipts) {
          try {
            await settleReceiptOnChain(r);
            getStore().addAuthorizedBuyer(
              poolHashHex,
              r.receipt.buyer.toBase58()
            );
          } catch (err) {
            console.error(
              `[scheduler] settle_receipt failed for buyer ` +
                `${r.receipt.buyer.toBase58().slice(0, 8)}... pool ` +
                `${poolHashHex.slice(0, 8)}...: ${(err as Error).message}`
            );
            // Drop the receipt — buyer can re-sign with a new nonce.
            // We don't requeue to avoid amplifying transient errors.
          }
        }
      } finally {
        settling.delete(poolHashHex);
      }
    })();
  }
}

/**
 * Drop pools and payloads whose freshness window has elapsed.
 */
export function tickPrune(): void {
  try {
    const { pools, payloads } = getStore().prune(Date.now());
    if (pools || payloads) {
      console.log(`[prune] dropped ${pools} pool(s), ${payloads} payload(s)`);
    }
  } catch (err) {
    console.error("[prune] error:", err);
  }
}

/**
 * Startup recovery sweep — pools left in `"fetching"` from a previous run
 * (crash between markFetching and markFetched) are reset so the next
 * request retriggers fetch. Expired ones are marked closed for prune.
 */
export function recoverStuckFetching(now: number = Date.now()): {
  reset: number;
  closed: number;
} {
  const store = getStore();
  let reset = 0;
  let closed = 0;
  for (const pool of store.listPools()) {
    if (pool.status !== "fetching") continue;
    if (pool.expiresAt !== undefined && pool.expiresAt < now) {
      store.setStatus(pool.requestHashHex, "closed");
      closed += 1;
    } else {
      store.setStatus(pool.requestHashHex, "pending");
      reset += 1;
    }
  }
  if (reset || closed) {
    console.log(
      `[recovery] cleared stuck 'fetching' pools: ${reset} → pending, ${closed} → closed`
    );
  }
  return { reset, closed };
}

export function startScheduler(): void {
  recoverStuckFetching();
  setInterval(() => void tickSettle(), SETTLE_INTERVAL_MS);
  setInterval(tickPrune, PRUNE_INTERVAL_MS);
}
