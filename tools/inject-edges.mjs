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
const OWN_KINDS = ["ANCHOR_RPC", "ANCHOR_KIT", "HTTP_CALL", "ROUTE_CALL"];

// These edge types also get a CALLS alias so callers_of / callees_of traversal works
const ALSO_EMIT_CALLS = new Set(["ANCHOR_RPC", "ANCHOR_KIT", "HTTP_CALL", "ROUTE_CALL"]);

// Map analyzer edge types → DB edge kind strings
const KIND_MAP = {
  anchor_rpc: "ANCHOR_RPC",
  anchor_kit: "ANCHOR_KIT",
  http_call: "HTTP_CALL",
  route_call: "ROUTE_CALL",
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

  // ── Collect all existing node qualified_names for validation ──
  const knownNodes = new Set(
    db.prepare("SELECT qualified_name FROM nodes").all().map((r) => r.qualified_name)
  );

  // ── Insert new edges ──
  const insert = db.prepare(`
    INSERT INTO edges (kind, source_qualified, target_qualified, file_path, line, extra, confidence, confidence_tier, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CROSS_RUNTIME', ?)
  `);

  let inserted = 0;
  let skipped = 0;
  const stats = Object.fromEntries(OWN_KINDS.map((k) => [k, 0]));
  const missing = [];

  for (const edge of edgesData.edges) {
    const kind = KIND_MAP[edge.type];
    if (!kind) continue;

    const sourceQN = abs(edge.from);
    const targetQN = abs(edge.to);
    const filePath = abs(edge.from.split("::")[0]);

    // Warn if source node doesn't exist (graph may not have parsed it yet)
    if (!knownNodes.has(sourceQN)) {
      missing.push({ role: "source", qn: sourceQN });
    }
    if (!knownNodes.has(targetQN)) {
      missing.push({ role: "target", qn: targetQN });
    }

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

    // Also insert as CALLS so callers_of/callees_of traversal picks it up.
    // If source node is missing (e.g. ::module for anonymous callbacks), fall back to the file node.
    if (ALSO_EMIT_CALLS.has(kind) && knownNodes.has(targetQN)) {
      let callsSrc = sourceQN;
      if (!knownNodes.has(callsSrc)) {
        // Fallback: use the file node (strip ::qualifier)
        callsSrc = callsSrc.split("::")[0];
      }
      if (knownNodes.has(callsSrc)) {
        insert.run("CALLS", callsSrc, targetQN, filePath, edge.line ?? 0, extra, confidence, now);
        inserted++;
      }
    }
  }

  console.log("\n✅  Injection complete!");
  console.log(`   ANCHOR_RPC  : ${stats.ANCHOR_RPC} edges`);
  console.log(`   ANCHOR_KIT  : ${stats.ANCHOR_KIT} edges`);
  console.log(`   HTTP_CALL   : ${stats.HTTP_CALL} edges`);
  console.log(`   ROUTE_CALL  : ${stats.ROUTE_CALL} edges`);
  console.log(`   ─────────────────────`);
  console.log(`   Total inserted : ${inserted}`);

  if (missing.length > 0) {
    const uniqueMissing = [...new Map(missing.map((m) => [m.qn, m])).values()];
    console.log(`\n⚠️   ${uniqueMissing.length} node(s) not yet in graph (edges still written):`);
    for (const m of uniqueMissing.slice(0, 10)) {
      console.log(`   [${m.role}] ${m.qn}`);
    }
    if (uniqueMissing.length > 10) {
      console.log(`   ... and ${uniqueMissing.length - 10} more`);
    }
    console.log(`   → These will resolve after next 'anchor build' + graph rebuild`);
  }

  db.close();

  console.log(`\n🔗  Full cross-runtime chain is now queryable in code-review-graph.`);
  console.log(
    `   Example: query_graph pattern=callers_of target="server/src/keeper.ts::triggerFetchOnChain"`
  );
}

run();
