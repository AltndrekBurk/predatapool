#!/usr/bin/env node
/**
 * PreDataPool — Devnet Interactive Demo
 *
 * Six simulated M2M agents request the same Open-Meteo weather endpoint;
 * the pool node fetches upstream ONCE and serves the cached payload to the
 * remaining five. Run with the pool node on http://localhost:3001 (set
 * SERVER_URL to override).
 *
 *   tsx examples/devnet-demo.ts
 *
 * The earlier `hackathon-demo/` warnings about eager initialize_pool +
 * unwired settle_batch + missing Light compression are now obsolete:
 *   - initialize_pool is LAZY (only on threshold)
 *   - settle_batch is wired end-to-end via scheduler.tickSettle
 *   - settle_receipt writes compressed BuyerSlot via Light Protocol
 * See AGENTS.md §2 and README's "Coalescing model" for the current shape.
 */

import { PoolClient } from "@predatapool/sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = "62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const ENDPOINT =
  process.env.DEMO_ENDPOINT ??
  "https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,wind_speed_10m";

const BUYERS = [
  "88FRN3hGUcv88DzrCKk4q85TSioL3Dv5ZjCJfyz8tsPC",
  "2WGYvoF6FUqgRnz8sr81qAxXdt4TajNSqPGTvJvV11GD",
  "EqaHDJ8eSaPAKstfn57peJy1BzsnC5Ji7LByLn5GbvcP",
  "C5347onFTjJFuUCbHuXbnPAfURL1kkXDiYZT2b1bu2fU",
  "8WaZgrR4RjGKoGWSgiTjiVWiCf93PUdVdBMGtobFaWQr",
  "3u51cSMpP1sRk7QYyAyQm2DJFSU25hoaWZc1qRnrGmWC",
];

const hr = (c = "─", n = 62) => c.repeat(n);
const explorer = (addr: string) =>
  `https://explorer.solana.com/address/${addr}?cluster=devnet`;

function derivePoolPda(poolHashHex: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("data_pool"), Buffer.from(poolHashHex, "hex")],
    new PublicKey(PROGRAM_ID)
  );
  return pda.toBase58();
}

async function main(): Promise<void> {
  const client = new PoolClient({ baseUrl: SERVER_URL });
  const connection = new Connection(RPC_URL, "confirmed");

  console.log(hr("═"));
  console.log("  PreDataPool — Devnet Coalescing Demo");
  console.log(hr("═"));
  console.log(`  Network  : Solana Devnet`);
  console.log(`  Program  : ${PROGRAM_ID}`);
  console.log(`  Server   : ${SERVER_URL}`);
  console.log(`  Endpoint : ${ENDPOINT.split("?")[0]}`);
  console.log(`  Buyers   : ${BUYERS.length} simulated M2M agents`);
  console.log(hr());
  console.log();

  // Phase 1 — first 2 agents trigger fetch (off-chain threshold)
  console.log("[phase 1] First 2 agents trigger upstream fetch");
  console.log(hr("-"));
  const results = [];
  for (let i = 0; i < 2; i++) {
    const res = await client.submitRequest({
      endpoint: ENDPOINT,
      buyerPubkey: BUYERS[i]!,
      dataType: "weather",
      freshnessWindowSecs: 60,
    });
    console.log(
      `  [${i + 1}/${BUYERS.length}] ${BUYERS[i]!.slice(0, 8)}...  ` +
        `pool=${res.poolHash.slice(0, 10)}...  ` +
        `cacheHit=${res.cacheHit}  fetchTriggered=${res.fetchTriggered}  ` +
        `status=${res.status}`
    );
    results.push(res);
  }

  const poolHash = results[1]!.poolHash;
  console.log();
  console.log(`[keeper] waiting for fetch + on-chain register_dataset...`);
  const meta = await pollUntilFetched(client, poolHash, 45_000);
  console.log(
    `[keeper] done — status=${meta.status}  buyers=${meta.buyerCount}  ` +
      `dataHash=${String(meta.dataHash ?? "").slice(0, 16)}...`
  );
  console.log();

  // On-chain PDA check
  const pdaAddress = derivePoolPda(poolHash);
  console.log("[chain] Pool PDA");
  console.log(`        Address : ${pdaAddress}`);
  console.log(`        Explorer: ${explorer(pdaAddress)}`);
  const info = await connection
    .getAccountInfo(new PublicKey(pdaAddress))
    .catch(() => null);
  if (info) {
    console.log(
      `        On-chain: lamports=${info.lamports}  data=${info.data.length} bytes  ✓ registered`
    );
  } else {
    console.log(
      `        On-chain: not found (keeper may be running without devnet keypair)`
    );
  }
  console.log();

  // Phase 2 — remaining 4 agents hit cache
  console.log("[phase 2] Remaining agents hit cache (one upstream fetch, N reuses)");
  console.log(hr("-"));
  let cacheHits = 0;
  for (let i = 2; i < BUYERS.length; i++) {
    const res = await client.submitRequest({
      endpoint: ENDPOINT,
      buyerPubkey: BUYERS[i]!,
      dataType: "weather",
      freshnessWindowSecs: 60,
    });
    if (res.cacheHit) cacheHits += 1;
    console.log(
      `  [${i + 1}/${BUYERS.length}] ${BUYERS[i]!.slice(0, 8)}...  ` +
        `cacheHit=${res.cacheHit}  price=${res.currentPriceFormatted}`
    );
  }
  console.log();

  console.log(hr("═"));
  console.log(
    `  Coalescing efficiency: ${cacheHits}/${BUYERS.length - 2} cache hits ` +
      `(${Math.round((cacheHits / (BUYERS.length - 2)) * 100)}% reuse)`
  );
  console.log(hr("═"));
}

async function pollUntilFetched(
  client: PoolClient,
  hash: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const meta = await client.getPoolMetadata(hash);
    last = meta;
    if (meta.status === "fetched") return meta;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(
    `Timeout: pool ${hash.slice(0, 8)} did not become 'fetched' ` +
      `(last status: ${last?.status})`
  );
}

void main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
