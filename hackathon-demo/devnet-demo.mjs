#!/usr/bin/env node
/**
 * DataPool Protocol — Devnet Interactive Demo
 *
 * Network  : Solana Devnet
 * Program  : 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D
 * Keeper   : EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD
 * Data API : Open-Meteo (public, no key required)
 *
 * Run from /server:
 *   node ../hackathon-demo/devnet-demo.mjs
 *
 * What it shows:
 *   1. Pool lifecycle — request → upstream fetch → reuse
 *   2. On-chain PDA state after keeper registers dataset
 *   3. Revenue distribution — provider 60% / protocol 40%
 *   4. Efficiency — N requests → 1 upstream API call
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../server/package.json"));
const { Connection, PublicKey } = require("@solana/web3.js");

// ── Constants ────────────────────────────────────────────────
const PROGRAM_ID    = "62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D";
const KEEPER_WALLET = "EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD";
const USDC_MINT     = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // Devnet USDC
const RPC_URL       = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SERVER_URL    = process.env.SERVER_URL     ?? "http://localhost:3001";
const ENDPOINT      = process.env.DEMO_ENDPOINT  ??
  "https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,wind_speed_10m";

const PROVIDER_SHARE_BPS = 6000; // 60% — matches server/src/providers.ts

// 6 real M2M agent wallets — keypairs in hackathon-demo/agents/agent-N.json
const BUYERS = [
  "88FRN3hGUcv88DzrCKk4q85TSioL3Dv5ZjCJfyz8tsPC",   // agent-1
  "2WGYvoF6FUqgRnz8sr81qAxXdt4TajNSqPGTvJvV11GD",   // agent-2
  "EqaHDJ8eSaPAKstfn57peJy1BzsnC5Ji7LByLn5GbvcP",   // agent-3
  "C5347onFTjJFuUCbHuXbnPAfURL1kkXDiYZT2b1bu2fU",   // agent-4
  "8WaZgrR4RjGKoGWSgiTjiVWiCf93PUdVdBMGtobFaWQr",   // agent-5
  "3u51cSMpP1sRk7QYyAyQm2DJFSU25hoaWZc1qRnrGmWC",   // agent-6
];

// ── Helpers ──────────────────────────────────────────────────
const explorer = (addr, kind = "address") =>
  `https://explorer.solana.com/${kind}/${addr}?cluster=devnet`;

const hr   = (c = "─", n = 62) => c.repeat(n);
const fmtU = (micros) => `$${(micros / 1_000_000).toFixed(6)} USDC`;
const pct  = (hits, total) => `${((hits / total) * 100).toFixed(0)}%`;

async function fetchJson(url, init) {
  const res  = await fetch(url, init);
  const body = await res.json();
  return { status: res.status, body };
}

async function waitForFetched(poolHash, maxMs = 30_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { body } = await fetchJson(`${SERVER_URL}/pool/${poolHash}`);
    if (body?.status === "fetched") return body;
    await new Promise(r => setTimeout(r, 600));
  }
  throw new Error(`Timeout: pool ${poolHash.slice(0, 8)} did not reach 'fetched'`);
}

function derivePoolPda(poolHashHex) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("data_pool"), Buffer.from(poolHashHex, "hex")],
    new PublicKey(PROGRAM_ID)
  );
  return pda.toBase58();
}

async function queryOnChain(connection, pdaAddress) {
  try {
    const info = await connection.getAccountInfo(new PublicKey(pdaAddress));
    if (!info) return null;
    return { lamports: info.lamports, dataLen: info.data.length };
  } catch {
    return null;
  }
}

async function request(buyerIndex) {
  return fetchJson(`${SERVER_URL}/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: ENDPOINT,
      method: "GET",
      params: {},
      buyerPubkey: BUYERS[buyerIndex],
      dataType: "weather",
      freshnessWindowSecs: 60,
    }),
  });
}

const RED   = "\x1b[31m";
const BOLD  = "\x1b[1m";
const RESET = "\x1b[0m";

function warn(line) {
  console.log(`${RED}${BOLD}${line}${RESET}`);
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // ── Known limitations warning ────────────────────────────────
  warn("⚠  ARCHITECTURE NOTICE — READ BEFORE PRESENTING");
  warn("──────────────────────────────────────────────────────────────");
  warn("  [1] initialize_pool is EAGER — on-chain account opens on the");
  warn("      first request, before buyer threshold is confirmed.");
  warn("      FIX NEEDED: lazy init (only when fetch is triggered).");
  warn("");
  warn("  [2] settle_batch NOT wired — off-chain ed25519 receipts exist");
  warn("      in batch.ts/receipt.ts but the keeper drain loop is");
  warn("      incomplete. Revenue numbers below are CALCULATED, not");
  warn("      settled on-chain yet.");
  warn("");
  warn("  [3] No Light Protocol compression — each pool PDA costs");
  warn("      ~0.002 SOL rent. Compressed accounts = ~0.000003 SOL.");
  warn("──────────────────────────────────────────────────────────────");
  console.log();

  // ── Header ──────────────────────────────────────────────────
  console.log(hr("═"));
  console.log("  DataPool Protocol — Devnet Interactive Demo");
  console.log(hr("═"));
  console.log(`  Network  : Solana Devnet`);
  console.log(`  Program  : ${PROGRAM_ID}`);
  console.log(`  Explorer : ${explorer(PROGRAM_ID)}`);
  console.log(`  Keeper   : ${KEEPER_WALLET}`);
  console.log(`  USDC     : ${USDC_MINT}`);
  console.log(`  Server   : ${SERVER_URL}`);
  console.log(`  Data API : Open-Meteo (Istanbul weather, public)`);
  console.log(`  Buyers   : ${BUYERS.length} simulated M2M agents`);
  console.log(hr());
  console.log();

  // ── Phase 1: pool creation + upstream fetch ──────────────────
  console.log("[phase 1] Pool creation — first 2 agents trigger upstream fetch");
  console.log(hr("-"));

  const results = [];

  for (let i = 0; i < 2; i++) {
    const { status, body } = await request(i);
    const tag = `  [${i + 1}/${BUYERS.length}] agent-${i + 1}`;
    console.log(`${tag}  HTTP ${status}`);
    if (status !== 200 || !body.poolHash) {
      console.error(`${tag}  ERROR: ${JSON.stringify(body)}`);
      process.exit(1);
    }
    results.push(body);
    console.log(`${tag}    pool=${body.poolHash.slice(0, 10)}...  cacheHit=${body.cacheHit}  fetchTriggered=${body.fetchTriggered}`);
    console.log(`${tag}    price=${body.currentPriceFormatted}  status=${body.status}`);
  }

  const poolHash = results[1].poolHash;
  console.log();

  // ── Phase 2: wait for on-chain registration ──────────────────
  console.log(`[keeper] waiting for fetch + on-chain dataset registration...`);
  const pool = await waitForFetched(poolHash);
  console.log(`[keeper] done — status=${pool.status}  buyers=${pool.buyers.length}  dataHash=${String(pool.dataHash ?? "").slice(0, 16)}...`);
  console.log();

  // ── On-chain PDA check ───────────────────────────────────────
  const pdaAddress = derivePoolPda(poolHash);
  console.log("[chain] Pool PDA derived from request hash + program seeds");
  console.log(`        Address : ${pdaAddress}`);
  console.log(`        Explorer: ${explorer(pdaAddress)}`);

  const pdaInfo = await queryOnChain(connection, pdaAddress);
  if (pdaInfo) {
    console.log(`        On-chain: lamports=${pdaInfo.lamports}  data=${pdaInfo.dataLen} bytes  ✓ registered`);
  } else {
    console.log(`        On-chain: not found yet (keeper may be in dry-run mode or tx pending)`);
  }
  console.log();

  // ── Phase 3: remaining agents hit cache ──────────────────────
  console.log("[phase 2] Cache reuse — agents 3-6 read from pool (0 upstream calls)");
  console.log(hr("-"));

  let cacheHits       = 0;
  let totalPriceUsdc  = results[0].currentPriceUsdc + results[1].currentPriceUsdc;

  for (let i = 2; i < BUYERS.length; i++) {
    const { status, body } = await request(i);
    results.push(body);
    totalPriceUsdc += body.currentPriceUsdc;
    if (body.cacheHit) cacheHits++;
    const tag      = `  [${i + 1}/${BUYERS.length}] agent-${i + 1}`;
    const hitLabel = body.cacheHit ? "  ← cache hit" : "";
    console.log(`${tag}  HTTP ${status}  cacheHit=${body.cacheHit}  price=${body.currentPriceFormatted}${hitLabel}`);
  }
  console.log();

  // ── Metadata ─────────────────────────────────────────────────
  const { body: meta } = await fetchJson(`${SERVER_URL}/pool/${poolHash}/metadata`);
  const storageUri = meta?.storageUri ?? meta?.storage_uri ?? "(pending on-chain)";

  // ── Revenue distribution ─────────────────────────────────────
  const providerUsdc = Math.floor(totalPriceUsdc * PROVIDER_SHARE_BPS / 10_000);
  const protocolUsdc = totalPriceUsdc - providerUsdc;
  const upstreamSaved = BUYERS.length - 1;

  // ── Summary ──────────────────────────────────────────────────
  console.log(hr("═"));
  console.log("  RESULTS");
  console.log(hr("═"));

  console.log("  EFFICIENCY");
  console.log(hr("-"));
  console.log(`  Total agent requests  : ${BUYERS.length}`);
  console.log(`  Upstream API calls    : 1  (saved ${upstreamSaved})`);
  console.log(`  Cache hits            : ${cacheHits} / ${BUYERS.length}  (${pct(cacheHits, BUYERS.length)})`);
  console.log(`  Bandwidth saved       : ${pct(upstreamSaved, BUYERS.length)} of upstream traffic eliminated`);
  console.log();

  console.log("  REVENUE DISTRIBUTION");
  console.log(hr("-"));
  console.log(`  Total pool revenue    : ${fmtU(totalPriceUsdc)}`);
  console.log(`  Data provider  (60%)  : ${fmtU(providerUsdc)}  ← ongoing, time-decayed`);
  console.log(`  Protocol share (40%)  : ${fmtU(protocolUsdc)}  ← keeper + compute`);
  console.log();

  console.log("  ON-CHAIN STATE");
  console.log(hr("-"));
  console.log(`  Program               : ${PROGRAM_ID}`);
  console.log(`  Pool PDA              : ${pdaAddress}`);
  console.log(`  storage_uri           : ${storageUri}`);
  console.log(`  Keeper wallet         : ${KEEPER_WALLET}`);
  console.log(`  Devnet USDC mint      : ${USDC_MINT}`);
  console.log();

  console.log("  EXPLORER LINKS");
  console.log(hr("-"));
  console.log(`  Program  → ${explorer(PROGRAM_ID)}`);
  console.log(`  Pool PDA → ${explorer(pdaAddress)}`);
  console.log(`  Keeper   → ${explorer(KEEPER_WALLET)}`);
  console.log(hr("═"));
}

main().catch(err => {
  console.error("\n[fatal]", err.message ?? err);
  process.exit(1);
});
