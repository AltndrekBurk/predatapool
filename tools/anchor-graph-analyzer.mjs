#!/usr/bin/env node
/**
 * anchor-graph-analyzer.mjs
 *
 * Detects cross-runtime edges that static analysis tools miss:
 *   anchor_rpc   : TS program.methods.<name>().rpc()  →  IDL instruction  →  Rust handler
 *   anchor_kit   : TS get<Name>Instruction()           →  IDL instruction  →  Rust handler
 *   http_call    : Frontend fetch(SERVER_URL/path)     →  Server route handler
 *   route_call   : Server route handler → keeper/matcher/fetcher functions
 *
 * Output: anchor_edges.json  (importable into code-review-graph)
 *
 * Usage: node tools/anchor-graph-analyzer.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function snakeToPascal(s) {
  const c = snakeToCamel(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Recursive glob — returns absolute paths matching extensions */
function glob(dir, exts) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      results.push(...glob(abs, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      results.push(abs);
    }
  }
  return results;
}

function rel(abs) {
  return relative(ROOT, abs);
}

// ─────────────────────────────────────────────
// IDL Loader
// ─────────────────────────────────────────────

function checkIdlFreshness() {
  const idlDir = join(ROOT, "anchor/target/idl");
  if (!existsSync(idlDir)) return; // will fail in loadAllIdls

  // Find newest .rs file under anchor/programs
  const rsFiles = glob(join(ROOT, "anchor/programs"), [".rs"]);
  if (rsFiles.length === 0) return;

  const newestRs = Math.max(...rsFiles.map((f) => statSync(f).mtimeMs));
  const idlFiles = readdirSync(idlDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => statSync(join(idlDir, f)).mtimeMs);

  if (idlFiles.length === 0 || newestRs > Math.max(...idlFiles)) {
    console.warn(
      "⚠️   IDL is stale (Rust files changed after last build).\n" +
      "    Run: cd anchor && ~/.cargo/bin/cargo build-sbf\n" +
      "    Or:  npm run anchor-build\n"
    );
  }
}

function loadAllIdls() {
  const idlDir = join(ROOT, "anchor/target/idl");
  if (!existsSync(idlDir)) {
    console.error("❌  anchor/target/idl not found — run `anchor build` first");
    process.exit(1);
  }
  checkIdlFreshness();

  const instructions = [];
  for (const file of readdirSync(idlDir).filter((f) => f.endsWith(".json"))) {
    const idl = JSON.parse(readFileSync(join(idlDir, file), "utf-8"));
    const programName = idl.metadata?.name ?? file.replace(".json", "");

    for (const ix of idl.instructions ?? []) {
      const name = ix.name; // snake_case
      instructions.push({
        name,
        camelCase: snakeToCamel(name),
        PascalCase: snakeToPascal(name),
        accounts: (ix.accounts ?? []).map((a) => a.name),
        program: programName,
        programId: idl.address,
      });
    }
  }
  return instructions;
}

// ─────────────────────────────────────────────
// Rust handler resolver
// ─────────────────────────────────────────────

function resolveRustHandler(instruction) {
  const { name, program } = instruction;

  // Dedicated instruction file (e.g. instructions/trigger_fetch.rs)
  const instrFile = join(ROOT, `anchor/programs/${program}/src/instructions/${name}.rs`);
  if (existsSync(instrFile)) {
    return {
      file: rel(instrFile),
      fn: `handle_${name}`,
      qualified: `anchor/programs/${program}/src/instructions/${name}.rs::handle_${name}`,
    };
  }

  // Fallback: lib.rs entry point
  const libFile = join(ROOT, `anchor/programs/${program}/src/lib.rs`);
  const libRel = rel(libFile);
  const content = existsSync(libFile) ? readFileSync(libFile, "utf-8") : "";
  const lineIdx = content.split("\n").findIndex((l) =>
    new RegExp(`pub fn ${name}\\s*[<(]`).test(l)
  );
  return {
    file: libRel,
    fn: name,
    line: lineIdx >= 0 ? lineIdx + 1 : undefined,
    qualified: `${libRel}::${name}`,
  };
}

// ─────────────────────────────────────────────
// Caller context (walk backwards from line)
// ─────────────────────────────────────────────

const FN_PATTERNS = [
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/,
  /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
  /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/,
  /(?:export\s+)?const\s+(\w+)\s*:\s*\w[^=]*=\s*(?:async\s+)?\(/,
];

// Variables that look like function context matches but are NOT functions
// Variable names and tiny helpers that look like functions but aren't meaningful callers
const SKIP_NAMES = new Set([
  "body", "result", "data", "response", "res", "req", "err", "error",
  "send", "readBody",  // server helpers defined above the route handler
]);

function getCallerContext(lines, lineIdx, filePath) {
  for (let i = lineIdx; i >= 0; i--) {
    for (const pat of FN_PATTERNS) {
      const m = lines[i].match(pat);
      if (m && !SKIP_NAMES.has(m[1])) return `${filePath}::${m[1]}`;
    }
    // IIFE pattern: (async () => { — attribute to nearest named function above
    if (/\(async\s*\(\)\s*=>/.test(lines[i])) continue; // skip, keep walking up
  }
  return `${filePath}::module`;
}

// ─────────────────────────────────────────────
// Server route extractor
// ─────────────────────────────────────────────

function extractServerRoutes(serverFiles) {
  const routes = [];

  for (const abs of serverFiles) {
    const filePath = rel(abs);
    const lines = readFileSync(abs, "utf-8").split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern A: req.method === "POST" && url.pathname === "/foo"
      let m = line.match(
        /req\.method\s*===\s*["'](\w+)["'].*url\.pathname\s*===\s*["']([^"']+)["']/
      );
      if (m) {
        routes.push({ method: m[1], pattern: m[2], file: filePath, line: i + 1 });
        continue;
      }

      // Pattern B: url.pathname === "/foo"  (method from nearby lines)
      m = line.match(/url\.pathname\s*===\s*["']([^"']+)["']/);
      if (m && !m[1].startsWith("http")) {
        const ctx = lines.slice(Math.max(0, i - 5), i + 2).join(" ");
        const method = ctx.match(/["'](GET|POST|PUT|DELETE|PATCH)["']/)?.[1] ?? "GET";
        routes.push({ method, pattern: m[1], file: filePath, line: i + 1 });
        continue;
      }

      // Pattern C: url.pathname.startsWith("/foo/")
      m = line.match(/pathname\.startsWith\s*\(\s*["']([^"']+)["']\s*\)/);
      if (m) {
        const ctx = lines.slice(Math.max(0, i - 5), i + 2).join(" ");
        const method = ctx.match(/["'](GET|POST|PUT|DELETE|PATCH)["']/)?.[1] ?? "GET";
        routes.push({
          method,
          pattern: m[1].replace(/\/$/, "") + "/:param",
          file: filePath,
          line: i + 1,
        });
        continue;
      }

      // Pattern D: Next.js App Router export function GET/POST/...
      m = line.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/);
      if (m) {
        const routePath = filePath
          .replace(/^app\//, "/")
          .replace(/\/route\.[tj]sx?$/, "")
          .replace(/\/page\.[tj]sx?$/, "");
        routes.push({
          method: m[1],
          pattern: routePath,
          file: filePath,
          line: i + 1,
        });
      }
    }
  }

  return routes;
}

// ─────────────────────────────────────────────
// HTTP fetch() matcher
// ─────────────────────────────────────────────

/** Extract the URL path from a fetch() call line */
function extractFetchUrlPath(line) {
  // fetch(`${VAR}/path`)  →  path
  let m = line.match(/fetch\s*\(\s*`\$\{[^}]+\}\/([^`'"$\s{}]+)/);
  if (m) return { path: m[1], confidence: "high" };

  // fetch("/path")  or  fetch('http://host/path')
  m = line.match(/fetch\s*\(\s*["'](?:https?:\/\/[^/]+)?\/([^"'?#\s]+)/);
  if (m) return { path: m[1], confidence: "high" };

  return null;
}

function matchRouteToFetch(urlPath, method, routes) {
  const normalUrl = "/" + urlPath.replace(/^\//, "");

  // Exact match first
  const exact = routes.find(
    (r) => r.method === method && r.pattern === normalUrl
  );
  if (exact) return exact;

  // Prefix match (for parameterized routes)
  const prefix = routes.find(
    (r) =>
      r.method === method &&
      r.pattern.endsWith(":param") &&
      normalUrl.startsWith(r.pattern.replace("/:param", ""))
  );
  return prefix ?? null;
}

// ─────────────────────────────────────────────
// Known internal call resolutions
// ─────────────────────────────────────────────

const INTERNAL_CALLS = {
  triggerFetchOnChain: "server/src/keeper.ts::triggerFetchOnChain",
  registerDatasetOnChain: "server/src/keeper.ts::registerDatasetOnChain",
  joinPool: "server/src/matcher.ts::joinPool",
  markFetching: "server/src/matcher.ts::markFetching",
  markFetched: "server/src/matcher.ts::markFetched",
  fetchData: "server/src/fetcher.ts::fetchData",
  currentPrice: "server/src/decay.ts::currentPrice",
};

// ─────────────────────────────────────────────
// Main analysis
// ─────────────────────────────────────────────

function analyze() {
  console.log("🔍  Loading IDLs from anchor/target/idl/...");
  const instructions = loadAllIdls();
  const programs = [...new Set(instructions.map((i) => i.program))];
  console.log(
    `    ${instructions.length} instructions across programs: ${programs.join(", ")}`
  );

  // Collect source files
  const appFiles = glob(join(ROOT, "app"), [".ts", ".tsx"]);
  const serverFiles = glob(join(ROOT, "server/src"), [".ts"]);
  const allTsFiles = [...appFiles, ...serverFiles];

  const serverRoutes = extractServerRoutes(serverFiles);
  console.log(
    `    ${serverRoutes.length} server routes detected in ${serverFiles.length} server files`
  );

  const edges = [];

  // ── Scan all TS/TSX files ──
  for (const abs of allTsFiles) {
    const filePath = rel(abs);

    // Skip generated files and type declarations
    if (filePath.includes("/generated/") || filePath.endsWith(".d.ts")) continue;

    const content = readFileSync(abs, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const caller = getCallerContext(lines, i, filePath);

      // ── Anchor: program.methods.<name>(...).rpc() ──
      // Handles both single-line and multi-line chaining:
      //   program.methods.triggerFetch(...)            ← same line
      //   program.methods\n    .triggerFetch(...)      ← method on next line
      const anchorMethodMatch =
        line.match(/program\.methods\.(\w+)\s*\(/) ||
        (line.match(/^\s*\.([a-z]\w+)\s*\(/) &&
          lines
            .slice(Math.max(0, i - 4), i)
            .some((l) => /program\.methods/.test(l)) &&
          line.match(/^\s*\.([a-z]\w+)\s*\(/)
        );

      if (anchorMethodMatch) {
        // camelName is in group 1 regardless of which branch matched
        const camelName = (
          line.match(/program\.methods\.(\w+)\s*\(/) ??
          line.match(/^\s*\.([a-z]\w+)\s*\(/)
        )[1];
        const ix = instructions.find((x) => x.camelCase === camelName);
        if (ix) {
          const handler = resolveRustHandler(ix);
          edges.push({
            type: "anchor_rpc",
            from: caller,
            via: `program.methods.${camelName}(...).rpc()`,
            idl_program: ix.program,
            idl_program_id: ix.programId,
            idl_instruction: ix.name,
            idl_accounts: ix.accounts,
            to: handler.qualified,
            line: i + 1,
            confidence: "high",
          });
        }
      }

      // ── Anchor Kit: get<Name>Instruction[Async](...) ──
      const kitMatch = line.match(/\bget([A-Z]\w+?)InstructionAsync?\s*\(/);
      if (kitMatch) {
        const pascalName = kitMatch[1];
        const ix = instructions.find((x) => x.PascalCase === pascalName);
        if (ix) {
          const handler = resolveRustHandler(ix);
          edges.push({
            type: "anchor_kit",
            from: caller,
            via: `get${pascalName}Instruction(...)`,
            idl_program: ix.program,
            idl_program_id: ix.programId,
            idl_instruction: ix.name,
            idl_accounts: ix.accounts,
            to: handler.qualified,
            line: i + 1,
            confidence: "high",
          });
        }
      }

      // ── HTTP: fetch(SERVER_URL/path) ──
      if (line.includes("fetch(") || line.includes("fetch (")) {
        const urlInfo = extractFetchUrlPath(line);
        if (urlInfo) {
          // Determine HTTP method from next few lines
          const ctx = lines.slice(i, Math.min(i + 6, lines.length)).join(" ");
          const method =
            ctx.match(/method:\s*["'](\w+)["']/)?.[1]?.toUpperCase() ?? "GET";

          const route = matchRouteToFetch(urlInfo.path, method, serverRoutes);
          edges.push({
            type: "http_call",
            from: caller,
            via: `fetch(${method} /${urlInfo.path})`,
            to: route
              ? `${route.file}::route(${method} ${route.pattern})`
              : `server::${method} /${urlInfo.path}`,
            line: i + 1,
            confidence: route ? "high" : "low",
          });
        }
      }

      // ── Internal server calls: triggerFetchOnChain, joinPool, etc. ──
      for (const [fnName, target] of Object.entries(INTERNAL_CALLS)) {
        if (
          new RegExp(`\\b${fnName}\\s*\\(`).test(line) &&
          !filePath.includes(target.split("::")[0]) // not the file defining it
        ) {
          edges.push({
            type: "route_call",
            from: caller,
            via: `${fnName}(...)`,
            to: target,
            line: i + 1,
            confidence: "high",
          });
        }
      }
    }
  }

  // ── Deduplicate ──
  const seen = new Set();
  const deduped = edges.filter((e) => {
    const key = `${e.from}|${e.to}|${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Summary ──
  const summary = {
    total: deduped.length,
    anchor_rpc: deduped.filter((e) => e.type === "anchor_rpc").length,
    anchor_kit: deduped.filter((e) => e.type === "anchor_kit").length,
    http_calls: deduped.filter((e) => e.type === "http_call").length,
    route_calls: deduped.filter((e) => e.type === "route_call").length,
  };

  const output = {
    generated_at: new Date().toISOString(),
    analyzer_version: "1.0.0",
    idl_programs: programs,
    summary,
    edges: deduped,
  };

  const outPath = join(ROOT, "anchor_edges.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  // ── Human-readable report ──
  console.log("\n✅  Analysis complete!");
  console.log(`    Anchor RPC edges : ${summary.anchor_rpc}`);
  console.log(`    Anchor Kit edges : ${summary.anchor_kit}`);
  console.log(`    HTTP call edges  : ${summary.http_calls}`);
  console.log(`    Route call edges : ${summary.route_calls}`);
  console.log(`    ─────────────────────`);
  console.log(`    Total            : ${summary.total}`);
  console.log(`\n    Written → anchor_edges.json\n`);

  console.log("📊  Cross-Runtime Chains (Anchor RPC):");
  for (const e of deduped.filter((e) => e.type === "anchor_rpc")) {
    console.log(`\n    ${e.from}`);
    console.log(`      ──[ ${e.via} ]──▶`);
    console.log(`      IDL : ${e.idl_program}.instructions.${e.idl_instruction}`);
    console.log(
      `      Accs: [${e.idl_accounts.join(", ")}]`
    );
    console.log(`      ──▶ ${e.to}`);
  }

  if (summary.anchor_kit > 0) {
    console.log("\n📊  Cross-Runtime Chains (Anchor Kit):");
    for (const e of deduped.filter((e) => e.type === "anchor_kit")) {
      console.log(`\n    ${e.from}`);
      console.log(`      ──[ ${e.via} ]──▶`);
      console.log(`      IDL : ${e.idl_program}.instructions.${e.idl_instruction}`);
      console.log(`      ──▶ ${e.to}`);
    }
  }

  console.log("\n📊  Frontend → Server (HTTP):");
  for (const e of deduped.filter((e) => e.type === "http_call")) {
    const badge = e.confidence === "high" ? "✓" : "?";
    console.log(`    [${badge}] ${e.from}`);
    console.log(`         ──[ ${e.via} ]──▶ ${e.to}`);
  }
}

analyze();
