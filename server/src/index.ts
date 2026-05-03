/**
 * DataPool Matching Server
 *
 * HTTP API for the off-chain coordination layer.
 * Receives buyer requests, deduplicates them, triggers x402 fetches,
 * and notifies the on-chain program via keeper keypair.
 *
 * Endpoints:
 *   POST /request   — buyer submits a data request
 *   GET  /pool/:hash — get pool status
 *   GET  /pools      — list all active pools
 *   GET  /health     — health check
 */

import http from "http";
import { joinPool, markFetching, markFetched, getPool, getAllPools } from "./matcher.js";
import { fetchData } from "./fetcher.js";
import { currentPrice, DECAY_PRESETS } from "./decay.js";
import { triggerFetchOnChain, registerDatasetOnChain } from "./keeper.js";

const PORT = process.env.PORT ?? 3001;

// Simple JSON request/response helpers
function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);

  try {
    // POST /request — buyer submits data request
    if (req.method === "POST" && url.pathname === "/request") {
      const body = (await readBody(req)) as {
        endpoint: string;
        params?: Record<string, string>;
        buyerPubkey: string;
        dataType?: keyof typeof DECAY_PRESETS;
      };

      const { pool, shouldTriggerFetch, isNewPool } = joinPool({
        endpoint: body.endpoint,
        params: body.params ?? {},
        buyerPubkey: body.buyerPubkey,
        maxPriceUsdc: 1_000_000,
      });

      // Trigger fetch if threshold met
      if (shouldTriggerFetch) {
        markFetching(pool.requestHashHex);

        // Fire-and-forget fetch
        (async () => {
          try {
            const result = await fetchData(body.endpoint, body.params ?? {});
            const dataHashHex = result.dataHash.toString("hex");
            markFetched(pool.requestHashHex, dataHashHex);

            // Content-addressed storage ref (swap for IPFS CID when pinning is wired)
            const storageRef = `sha256:${dataHashHex}`;

            // Commit fetch on-chain: sets fetched_at + data_hash, reopens pool for post-fetch buyers
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

      send(res, 200, {
        poolHash: pool.requestHashHex,
        status: pool.status,
        buyerCount: pool.buyers.length,
        isNewPool,
        fetchTriggered: shouldTriggerFetch,
        currentPriceUsdc: priceNow,
        currentPriceFormatted: `$${(priceNow / 1_000_000).toFixed(6)}`,
      });
      return;
    }

    // GET /pool/:hash — pool status
    if (req.method === "GET" && url.pathname.startsWith("/pool/")) {
      const hashHex = url.pathname.split("/")[2];
      const pool = getPool(hashHex);
      if (!pool) {
        send(res, 404, { error: "Pool not found" });
        return;
      }
      send(res, 200, {
        ...pool,
        requestHash: pool.requestHash.toString("hex"),
      });
      return;
    }

    // GET /pools — all pools
    if (req.method === "GET" && url.pathname === "/pools") {
      const allPools = getAllPools().map((p) => ({
        ...p,
        requestHash: p.requestHash.toString("hex"),
      }));
      send(res, 200, { pools: allPools, count: allPools.length });
      return;
    }

    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { status: "ok", version: "0.1.0" });
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[server] Error:", err);
    send(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`DataPool matching server running on http://localhost:${PORT}`);
  console.log(`  POST /request    — submit a data request`);
  console.log(`  GET  /pools      — list all pools`);
  console.log(`  GET  /health     — health check`);
});
