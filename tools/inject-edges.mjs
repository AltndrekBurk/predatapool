#!/usr/bin/env node
/**
 * inject-edges.mjs
 *
 * Injects anchor_edges.json into the code-review-graph SQLite database.
 * Adds cross-runtime edges that static analysis cannot detect:
 *   ANCHOR_RPC   — program.methods.<name>().rpc()  →  Rust handler
 *   ANCHOR_KIT   — get<Name>Instruction()           →  Rust handler
 *   HTTP_CALL    — fetch(METHOD /path)              →  Server route
 *   ROUTE_CALL   — Server route handler             →  keeper/matcher/fetcher
 *
 * Safe to re-run: existing ANCHOR_RPC/HTTP_CALL edges are deleted and re-inserted.
 *
 * Usage: node tools/inject-edges.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DB_PATH = join(ROOT, ".code-review-graph/graph.db");
const EDGES_PATH = join(ROOT, "anchor_edges.json");

// Edge kinds we own — delete these before reinserting so re-runs are idempotent
const OWN_KINDS = [
  "ANCHOR_RPC", "ANCHOR_RPC_LEGACY", "ANCHOR_DYNAMIC", "ANCHOR_KIT",
  "HTTP_CALL", "SWR_CALL", "SOLANA_RPC", "SOLANA_SUBSCRIBE",
  "ROUTE_CALL", "RUST_CPI",
];

// These edge types also get a CALLS alias so callers_of / callees_of traversal works
const ALSO_EMIT_CALLS = new Set([
  "ANCHOR_RPC", "ANCHOR_RPC_LEGACY", "ANCHOR_DYNAMIC", "ANCHOR_KIT",
  "HTTP_CALL", "SWR_CALL", "SOLANA_RPC", "SOLANA_SUBSCRIBE",
  "ROUTE_CALL", "RUST_CPI",
]);

// Map analyzer edge types → DB edge kind strings
const KIND_MAP = {
  anchor_rpc:        "ANCHOR_RPC",
  anchor_rpc_legacy: "ANCHOR_RPC_LEGACY",
  anchor_dynamic:    "ANCHOR_DYNAMIC",
  anchor_kit:        "ANCHOR_KIT",
  http_call:         "HTTP_CALL",
  swr_call:          "SWR_CALL",
  solana_rpc:        "SOLANA_RPC",
  solana_subscribe:  "SOLANA_SUBSCRIBE",
  route_call:        "ROUTE_CALL",
  rust_cpi:          "RUST_CPI",
};

function abs(relPath) {
  // Convert relative path like "server/src/keeper.ts::fn" → absolute qualified name
  if (relPath.startsWith("/")) return relPath;
  const [filePart, fnPart] = relPath.split("::");
  const absFile = join(ROOT, filePart);
  return fnPart ? `${absFile}::${fnPart}` : absFile;
}

function run() {
  console.log("📥  Injecting cross-runtime edges into code-review-graph...\n");

  // Node.js 22+ has built-in sqlite; fall back to better-sqlite3 if needed
  let db;
  try {
    db = new DatabaseSync(DB_PATH);
  } catch (e) {
    console.error("❌  node:sqlite unavailable — install better-sqlite3 or use Node 22+");
    console.error(e.message);
    process.exit(1);
  }

  const edgesData = JSON.parse(readFileSync(EDGES_PATH, "utf-8"));
  const now = Date.now() / 1000;

  // ── Delete existing cross-runtime edges (including CALLS aliases) ──
  for (const kind of OWN_KINDS) {
    const result = db.prepare(`DELETE FROM edges WHERE kind = ?`).run(kind);
    if (result.changes > 0) {
      console.log(`   Removed ${result.changes} stale ${kind} edges`);
    }
  }
  // Remove CALLS edges that were injected by this tool (confidence_tier = CROSS_RUNTIME)
  const callsRemoved = db.prepare(
    `DELETE FROM edges WHERE kind = 'CALLS' AND confidence_tier = 'CROSS_RUNTIME'`
  ).run();
  if (callsRemoved.changes > 0) {
    console.log(`   Removed ${callsRemoved.changes} stale CALLS(cross-runtime) edges`);
  }

  // ── Delete synthetic nodes we previously inserted ──
  db.prepare(`DELETE FROM nodes WHERE extra LIKE '%"synthetic":true%'`).run();

  // ── Collect all existing node qualified_names ──
  const knownNodes = new Set(
    db.prepare("SELECT qualified_name FROM nodes").all().map((r) => r.qualified_name)
  );

  // ── Insert synthetic nodes for missing source/target qualified names ──
  const insertNode = db.prepare(`
    INSERT INTO nodes (kind, name, qualified_name, file_path, line_start, line_end, language, is_test, extra, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'typescript', 0, '{"synthetic":true}', ?)
  `);

  function ensureNode(qualifiedName, lineHint) {
    if (knownNodes.has(qualifiedName)) return;
    const filePart = qualifiedName.split("::")[0];
    const namePart = qualifiedName.split("::").slice(1).join("::");
    insertNode.run("Function", namePart || filePart, qualifiedName, filePart, lineHint ?? 0, lineHint ?? 0, now);
    knownNodes.add(qualifiedName);
  }

  // ── Insert new edges ──
  const insert = db.prepare(`
    INSERT INTO edges (kind, source_qualified, target_qualified, file_path, line, extra, confidence, confidence_tier, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CROSS_RUNTIME', ?)
  `);

  let inserted = 0;
  const stats = Object.fromEntries(OWN_KINDS.map((k) => [k, 0]));

  for (const edge of edgesData.edges) {
    const kind = KIND_MAP[edge.type];
    if (!kind) continue;

    const sourceQN = abs(edge.from);
    const targetQN = abs(edge.to);
    const filePath = abs(edge.from.split("::")[0]);

    // Ensure both endpoints exist as nodes (create synthetic if missing)
    ensureNode(sourceQN, edge.line);
    ensureNode(targetQN, edge.line);

    const extra = JSON.stringify({
      via: edge.via,
      ...(edge.idl_instruction ? { idl_instruction: edge.idl_instruction } : {}),
      ...(edge.idl_program ? { idl_program: edge.idl_program } : {}),
      ...(edge.idl_accounts ? { idl_accounts: edge.idl_accounts } : {}),
      ...(edge.idl_program_id ? { idl_program_id: edge.idl_program_id } : {}),
      confidence: edge.confidence,
    });

    const confidence = edge.confidence === "high" ? 0.9 : 0.5;

    insert.run(kind, sourceQN, targetQN, filePath, edge.line ?? 0, extra, confidence, now);
    inserted++;
    stats[kind]++;

    // Also emit as CALLS so callers_of/callees_of traversal works
    if (ALSO_EMIT_CALLS.has(kind)) {
      insert.run("CALLS", sourceQN, targetQN, filePath, edge.line ?? 0, extra, confidence, now);
      inserted++;
    }
  }

  const syntheticCount = db.prepare(`SELECT COUNT(*) as n FROM nodes WHERE extra LIKE '%"synthetic":true%'`).get().n;

  console.log("\n✅  Injection complete!");
  for (const kind of OWN_KINDS) {
    if (stats[kind] > 0) console.log(`   ${kind.padEnd(20)}: ${stats[kind]} edges`);
  }
  console.log(`   ────────────────────────`);
  console.log(`   Total edges     : ${inserted}`);
  console.log(`   Synthetic nodes : ${syntheticCount}`);

  db.close();

  console.log(`\n🔗  Full cross-runtime chain is now queryable in code-review-graph.`);
  console.log(
    `   Example: query_graph pattern=callers_of target="server/src/keeper.ts::triggerFetchOnChain"`
  );
}

run();
