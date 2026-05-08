import express from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import { joinPool, markFetching, markFetched, getPool, getAllPools } from "./matcher.js";
import { fetchData } from "./fetcher.js";
import { currentPrice, DECAY_PRESETS } from "./decay.js";
import {
  triggerFetchOnChain,
  registerDatasetOnChain,
  initializePoolOnChain,
  settleReceiptOnChain,
} from "./keeper.js";
import { lookupProvider } from "./providers.js";
import {
  acceptReceipt,
  drainBatch,
  getPendingBatch,
  listPoolsWithPending,
  ReceiptError,
} from "./batch.js";
import type { JoinReceipt } from "./receipt.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // Devnet USDC
);

/**
 * Tracks pending on-chain `initialize_pool` txns by pool hash so we can
 * await them before subsequent instructions (trigger_fetch, register_dataset).
 * The on-chain pool must exist before those run.
 */
const pendingInits = new Map<string, Promise<unknown>>();

app.use(cors());
app.use(express.json());

app.post("/request", async (req, res) => {
  try {
    const body = req.body as {
      endpoint: string;
      params?: Record<string, string>;
      buyerPubkey: string;
      dataType?: keyof typeof DECAY_PRESETS;
    };

    const earlyAgreement = lookupProvider(body.endpoint);
    const { pool, shouldTriggerFetch, isNewPool } = joinPool({
      endpoint: body.endpoint,
      params: body.params ?? {},
      buyerPubkey: body.buyerPubkey,
      maxPriceUsdc: 1_000_000,
      minBuyers: earlyAgreement.minBuyers,
    });

    // New off-chain pool → initialize the matching on-chain DataPool so future
    // buyers can call join_pool and the keeper can later trigger_fetch.
    // Fire-and-forget; we track the promise and await it before trigger_fetch.
    if (isNewPool) {
      const agreement = earlyAgreement;
      const initPromise = initializePoolOnChain({
        requestHashHex: pool.requestHashHex,
        basePriceUsdc: agreement.basePriceUsdc,
        minBuyers: agreement.minBuyers,
        decayBpsPerHour: agreement.buyerDecayBpsPerHour,
        provider: agreement.provider,
        providerShareBps: agreement.providerShareBps,
        providerDecayBpsPerHour: agreement.providerDecayBpsPerHour,
        usdcMint: USDC_MINT,
      }).catch((err) => {
        // Pool may already exist from a prior session — log and continue.
        console.error(
          `[server] initialize_pool failed for ${pool.requestHashHex.slice(0, 8)}...:`,
          (err as Error).message
        );
      });
      pendingInits.set(pool.requestHashHex, initPromise);
    }

    if (shouldTriggerFetch) {
      markFetching(pool.requestHashHex);

      (async () => {
        try {
          // Ensure on-chain pool exists before trigger_fetch runs.
          const init = pendingInits.get(pool.requestHashHex);
          if (init) {
            await init;
            pendingInits.delete(pool.requestHashHex);
          }

          const result = await fetchData(body.endpoint, body.params ?? {});
          const dataHashHex = result.dataHash.toString("hex");
          markFetched(pool.requestHashHex, dataHashHex);

          const storageRef = `sha256:${dataHashHex}`;

          await triggerFetchOnChain(pool.requestHashHex, dataHashHex);
          await registerDatasetOnChain(pool.requestHashHex, storageRef);

          console.log(
            `[server] Pool ${pool.requestHashHex.slice(0, 8)}... fetched & registered. ` +
              `Data hash: ${dataHashHex.slice(0, 16)}...`
          );
        } catch (err) {
          console.error(`[server] Fetch failed:`, err);
        }
      })();
    }

    const preset = DECAY_PRESETS[body.dataType ?? "api_response"];
    const priceNow = currentPrice(preset, pool.fetchedAt ?? 0);

    res.status(200).json({
      poolHash: pool.requestHashHex,
      status: pool.status,
      buyerCount: pool.buyers.length,
      isNewPool,
      fetchTriggered: shouldTriggerFetch,
      currentPriceUsdc: priceNow,
      currentPriceFormatted: `$${(priceNow / 1_000_000).toFixed(6)}`,
    });
  } catch (err) {
    console.error("[server] Error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/pool/:hash", (req, res) => {
  const pool = getPool(req.params.hash);

  if (!pool) {
    res.status(404).json({ error: "Pool not found" });
    return;
  }

  res.status(200).json({
    ...pool,
    requestHash: pool.requestHash.toString("hex"),
  });
});

app.get("/pools", (_req, res) => {
  const allPools = getAllPools().map((p) => ({
    ...p,
    requestHash: p.requestHash.toString("hex"),
  }));

  res.status(200).json({
    pools: allPools,
    count: allPools.length,
  });
});

/**
 * Off-chain receipt submission. Buyer signs a 104-byte canonical
 * JoinReceipt with their wallet, posts it here. Server validates the
 * Ed25519 signature, freshness, and replay-safety, then queues for the
 * next batch settlement. No on-chain tx is sent at this point.
 */
app.post("/receipt", (req, res) => {
  try {
    const body = req.body as {
      poolHash: string; // 32-byte hex
      buyer: string; // base58
      maxPrice: string; // u64 decimal
      nonce: string; // u64 decimal
      deadline: string; // i64 decimal (unix seconds)
      signedMessage: string; // hex
      signature: string; // 64-byte hex
    };

    const poolHash = Buffer.from(body.poolHash, "hex");
    if (poolHash.length !== 32) {
      res.status(400).json({ error: "poolHash must be 32 bytes hex" });
      return;
    }

    const receipt: JoinReceipt = {
      poolHash: new Uint8Array(poolHash),
      buyer: new PublicKey(body.buyer),
      maxPrice: BigInt(body.maxPrice),
      nonce: BigInt(body.nonce),
      deadline: BigInt(body.deadline),
    };

    const result = acceptReceipt({
      receipt,
      signedMessage: new Uint8Array(Buffer.from(body.signedMessage, "hex")),
      signature: new Uint8Array(Buffer.from(body.signature, "hex")),
    });

    res.status(200).json({
      ok: true,
      poolHash: result.poolHashHex,
      batchSize: result.batchSize,
      reused: result.reused,
    });
  } catch (err) {
    if (err instanceof ReceiptError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[server] /receipt error:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Inspect the pending batch for a pool. Read-only debug surface; the
 * scheduler is what actually drains and settles it.
 */
app.get("/pool/:hash/batch", (req, res) => {
  const batch = getPendingBatch(req.params.hash);
  res.status(200).json({
    poolHash: req.params.hash,
    pending: batch.length,
    receipts: batch.map((r) => ({
      buyer: r.receipt.buyer.toBase58(),
      maxPrice: r.receipt.maxPrice.toString(),
      nonce: r.receipt.nonce.toString(),
      deadline: r.receipt.deadline.toString(),
      receivedAt: r.receivedAt,
    })),
  });
});

app.get("/batches", (_req, res) => {
  const pools = listPoolsWithPending();
  res.status(200).json({
    pools,
    totalPending: pools.reduce(
      (sum, p) => sum + getPendingBatch(p).length,
      0
    ),
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    version: "0.1.0",
  });
});

/**
 * Settlement scheduler — drains pending receipts and submits each as a
 * settle_receipt transaction. Runs every SETTLE_INTERVAL_MS without
 * blocking the request path: buyer-facing endpoints (POST /receipt) ack
 * immediately and never wait on the chain.
 *
 * One in-flight settlement per pool at a time prevents nonce-collision
 * races between concurrent settle_receipt txs targeting the same buyer.
 */
const SETTLE_INTERVAL_MS = Number(process.env.SETTLE_INTERVAL_MS ?? 5000);
const settling = new Set<string>();

async function tickSettle(): Promise<void> {
  const pools = listPoolsWithPending();
  for (const poolHashHex of pools) {
    if (settling.has(poolHashHex)) continue;
    settling.add(poolHashHex);

    (async () => {
      try {
        // Wait for any in-flight initialize_pool — settle_receipt needs the
        // on-chain DataPool to exist.
        const init = pendingInits.get(poolHashHex);
        if (init) {
          await init;
          pendingInits.delete(poolHashHex);
        }

        const receipts = drainBatch(poolHashHex);
        for (const r of receipts) {
          try {
            await settleReceiptOnChain(r);
          } catch (err) {
            console.error(
              `[scheduler] settle_receipt failed for buyer ` +
                `${r.receipt.buyer.toBase58().slice(0, 8)}... pool ` +
                `${poolHashHex.slice(0, 8)}...: ${(err as Error).message}`
            );
            // Receipt is dropped — buyer can sign a fresh one with a new
            // nonce. We don't requeue to avoid amplifying transient errors.
          }
        }
      } finally {
        settling.delete(poolHashHex);
      }
    })();
  }
}

setInterval(() => {
  void tickSettle();
}, SETTLE_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`DataPool matching server running on http://localhost:${PORT}`);
  console.log(`  POST /request    — submit a data request`);
  console.log(`  POST /receipt    — submit a signed JoinReceipt`);
  console.log(`  GET  /pools      — list all pools`);
  console.log(`  GET  /batches    — pools with pending receipts`);
  console.log(`  GET  /health     — health check`);
  console.log(`  Settlement tick: every ${SETTLE_INTERVAL_MS}ms`);
});