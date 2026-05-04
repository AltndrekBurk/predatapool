#!/usr/bin/env node
/**
 * anchor-graph-analyzer.mjs
 *
 * Comprehensive cross-runtime edge detector for Solana full-stack projects.
 *
 * Edge types emitted:
 *   anchor_rpc        – program.methods.X().rpc()          → Rust handler
 *   anchor_rpc_legacy – program.rpc.X()                    → Rust handler
 *   anchor_dynamic    – program.methods[var]() via data-flow→ Rust handler
 *   anchor_kit        – getXInstruction[Async]()            → Rust handler
 *   http_call         – fetch() / axios()                   → server route
 *   swr_call          – useSWR(key, () => fn())             → fetcher fn
 *   solana_rpc        – client.rpc.X().send()               → Solana RPC
 *   solana_subscribe  – rpcSubscriptions.X().subscribe()    → WS subscription
 *   route_call        – server route handler                → keeper/matcher/…
 *   rust_cpi          – Rust CpiContext + token/system call → SPL program
 *
 * Usage:  node tools/anchor-graph-analyzer.mjs
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
function camelToSnake(s) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

function glob(dir, exts) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (["node_modules", ".next", "dist", "target"].includes(entry)) continue;
      results.push(...glob(abs, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      results.push(abs);
    }
  }
  return results;
}

function rel(abs) { return relative(ROOT, abs); }

// ─────────────────────────────────────────────
// IDL Loader
// ─────────────────────────────────────────────

function checkIdlFreshness() {
  const idlDir = join(ROOT, "anchor/target/idl");
  if (!existsSync(idlDir)) return;
  const rsFiles = glob(join(ROOT, "anchor/programs"), [".rs"]);
  if (!rsFiles.length) return;
  const newestRs = Math.max(...rsFiles.map((f) => statSync(f).mtimeMs));
  const idlMtimes = readdirSync(idlDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => statSync(join(idlDir, f)).mtimeMs);
  if (!idlMtimes.length || newestRs > Math.max(...idlMtimes)) {
    console.warn("⚠️   IDL is stale — run: cd anchor && ~/.cargo/bin/cargo build-sbf\n");
  }
}

function loadAllIdls() {
  const idlDir = join(ROOT, "anchor/target/idl");
  if (!existsSync(idlDir)) {
    console.error("❌  anchor/target/idl not found — run anchor build first");
    process.exit(1);
  }
  checkIdlFreshness();

  const instructions = [];
  for (const file of readdirSync(idlDir).filter((f) => f.endsWith(".json"))) {
    const idl = JSON.parse(readFileSync(join(idlDir, file), "utf-8"));
    const programName = idl.metadata?.name ?? file.replace(".json", "");
    for (const ix of idl.instructions ?? []) {
      instructions.push({
        name: ix.name,
        camelCase: snakeToCamel(ix.name),
        PascalCase: snakeToPascal(ix.name),
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

function resolveRustHandler(ix) {
  const instrFile = join(ROOT, `anchor/programs/${ix.program}/src/instructions/${ix.name}.rs`);
  if (existsSync(instrFile)) {
    return `anchor/programs/${ix.program}/src/instructions/${ix.name}.rs::handle_${ix.name}`;
  }
  return `anchor/programs/${ix.program}/src/lib.rs::${ix.name}`;
}

// ─────────────────────────────────────────────
// Intra-file data flow — simple constant propagation
// ─────────────────────────────────────────────

/**
 * Scans all lines of a file and returns a map of variable → string literal value.
 * Handles:
 *   const name = "value"
 *   const url = `${BASE}/path`   → captures just "/path" suffix
 *   const url = BASE + "/path"   → captures "/path" suffix
 */
function extractStringBindings(lines) {
  const bindings = new Map();
  for (const line of lines) {
    // const/let name = "literal"
    let m = line.match(/(?:const|let)\s+(\w+)\s*=\s*["']([^"']+)["']/);
    if (m) { bindings.set(m[1], m[2]); continue; }
    // const/let name = `${VAR}/path`
    m = line.match(/(?:const|let)\s+(\w+)\s*=\s*`[^`]*?(\/[^`${}]+)`/);
    if (m) { bindings.set(m[1], m[2]); continue; }
    // const/let name = SOMETHING + "/path"
    m = line.match(/(?:const|let)\s+(\w+)\s*=\s*\w+\s*\+\s*["'](\/[^"']+)["']/);
    if (m) { bindings.set(m[1], m[2]); continue; }
  }
  return bindings;
}

// ─────────────────────────────────────────────
// Caller context
// ─────────────────────────────────────────────

const FN_PATTERNS = [
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/,
  /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
  /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/,
  /(?:export\s+)?const\s+(\w+)\s*:\s*\w[^=]*=\s*(?:async\s+)?\(/,
  // React hooks: const handleX = useCallback/useMemo/useEffect(async () =>
  /(?:export\s+)?const\s+(\w+)\s*=\s*use\w+\s*\(\s*(?:async\s+)?\(/,
  // pub fn X in Rust
  /pub\s+fn\s+(\w+)\s*[<(]/,
];

const SKIP_NAMES = new Set([
  "body", "result", "data", "response", "res", "req", "err", "error",
  "send", "readBody", "server", "subscribe", "notifications",
]);

const ROUTE_IF = /req\.method\s*===\s*["'](\w+)["'].*url\.pathname\s*(?:===\s*["']([^"']+)["']|\.startsWith\s*\(["']([^"']+)["']\))/;

function routeHandlerName(filePath, method, pattern) {
  const slug = pattern.replace(/\//g, "_").replace(/^_/, "").replace(/:/g, "") || "root";
  return `${filePath}::http_handler_${method.toUpperCase()}_${slug}`;
}

function getCallerContext(lines, lineIdx, filePath) {
  // Route if-block check (server HTTP handlers)
  for (let i = lineIdx; i >= 0; i--) {
    const rm = lines[i].match(ROUTE_IF);
    if (rm) return routeHandlerName(filePath, rm[1], rm[2] ?? rm[3] ?? "unknown");
    if (/createServer/.test(lines[i])) break;
  }
  // Named function walk
  for (let i = lineIdx; i >= 0; i--) {
    for (const pat of FN_PATTERNS) {
      const m = lines[i].match(pat);
      if (m && !SKIP_NAMES.has(m[1])) return `${filePath}::${m[1]}`;
    }
    if (/\(async\s*\(\)\s*=>/.test(lines[i])) continue;
  }
  return `${filePath}::module`;
}

// ─────────────────────────────────────────────
// Server route extractor
// ─────────────────────────────────────────────

function extractServerRoutes(serverFiles) {
  const routes = [];
  for (const abs of serverFiles) {
    const fp = rel(abs);
    const lines = readFileSync(abs, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m = line.match(/req\.method\s*===\s*["'](\w+)["'].*url\.pathname\s*===\s*["']([^"']+)["']/);
      if (m) { routes.push({ method: m[1], pattern: m[2], file: fp, line: i + 1 }); continue; }
      m = line.match(/url\.pathname\s*===\s*["']([^"']+)["']/);
      if (m && !m[1].startsWith("http")) {
        const ctx = lines.slice(Math.max(0, i - 5), i + 2).join(" ");
        const method = ctx.match(/["'](GET|POST|PUT|DELETE|PATCH)["']/)?.[1] ?? "GET";
        routes.push({ method, pattern: m[1], file: fp, line: i + 1 }); continue;
      }
      m = line.match(/pathname\.startsWith\s*\(\s*["']([^"']+)["']\s*\)/);
      if (m) {
        const ctx = lines.slice(Math.max(0, i - 5), i + 2).join(" ");
        const method = ctx.match(/["'](GET|POST|PUT|DELETE|PATCH)["']/)?.[1] ?? "GET";
        routes.push({ method, pattern: m[1].replace(/\/$/, "") + "/:param", file: fp, line: i + 1 }); continue;
      }
      // Express/Hono: app.get("/path", ...) or router.post("/path", ...)
      m = line.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
      if (m) { routes.push({ method: m[1].toUpperCase(), pattern: m[2], file: fp, line: i + 1 }); continue; }
      // Next.js App Router: export async function GET/POST
      m = line.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/);
      if (m) {
        const routePath = fp.replace(/^app\//, "/").replace(/\/route\.[tj]sx?$/, "").replace(/\/page\.[tj]sx?$/, "");
        routes.push({ method: m[1], pattern: routePath, file: fp, line: i + 1 });
      }
    }
  }
  return routes;
}

// ─────────────────────────────────────────────
// HTTP fetch() matcher
// ─────────────────────────────────────────────

function extractFetchUrlPath(line, bindings) {
  // fetch(`${VAR}/path`)
  let m = line.match(/fetch\s*\(\s*`\$\{[^}]+\}\/([^`'"$\s{}]+)/);
  if (m) return { path: m[1], confidence: "high" };
  // fetch("/path") or fetch("http://host/path")
  m = line.match(/fetch\s*\(\s*["'](?:https?:\/\/[^/]+)?\/([^"'?#\s]+)/);
  if (m) return { path: m[1], confidence: "high" };
  // fetch(varName) — resolve via data flow
  m = line.match(/fetch\s*\(\s*(\w+)\s*[,)]/);
  if (m && bindings.has(m[1])) {
    const val = bindings.get(m[1]).replace(/^\//, "");
    return { path: val, confidence: "medium" };
  }
  return null;
}

function matchRouteToFetch(urlPath, method, routes) {
  const normalUrl = "/" + urlPath.replace(/^\//, "");
  return (
    routes.find((r) => r.method === method && r.pattern === normalUrl) ??
    routes.find((r) => r.method === method && r.pattern.endsWith(":param") &&
      normalUrl.startsWith(r.pattern.replace("/:param", ""))) ??
    null
  );
}

// ─────────────────────────────────────────────
// Known internal call resolutions
// ─────────────────────────────────────────────

const INTERNAL_CALLS = {
  triggerFetchOnChain:   "server/src/keeper.ts::triggerFetchOnChain",
  registerDatasetOnChain:"server/src/keeper.ts::registerDatasetOnChain",
  joinPool:              "server/src/matcher.ts::joinPool",
  markFetching:          "server/src/matcher.ts::markFetching",
  markFetched:           "server/src/matcher.ts::markFetched",
  fetchData:             "server/src/fetcher.ts::fetchData",
  currentPrice:          "server/src/decay.ts::currentPrice",
};

// ─────────────────────────────────────────────
// Rust CPI patterns
// ─────────────────────────────────────────────

const RUST_CPI_TARGETS = {
  "token::transfer":           "spl_token::instruction::transfer",
  "token::mint_to":            "spl_token::instruction::mint_to",
  "token::burn":               "spl_token::instruction::burn",
  "system_program::transfer":  "solana_program::system_instruction::transfer",
  "system_program::create_account": "solana_program::system_instruction::create_account",
  "associated_token::create":  "spl_associated_token_account::instruction::create",
};

function extractRustCpiEdges(abs, filePath) {
  const edges = [];
  const content = readFileSync(abs, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [pattern, target] of Object.entries(RUST_CPI_TARGETS)) {
      if (line.includes(pattern + "(")) {
        const caller = getCallerContext(lines, i, filePath);
        edges.push({
          type: "rust_cpi",
          from: caller,
          via: `${pattern}(cpi_ctx, ...)`,
          to: target,
          line: i + 1,
          confidence: "high",
        });
      }
    }
  }
  return edges;
}

// ─────────────────────────────────────────────
// Main analysis
// ─────────────────────────────────────────────

function analyze() {
  console.log("🔍  Loading IDLs...");
  const instructions = loadAllIdls();
  const programs = [...new Set(instructions.map((i) => i.program))];
  console.log(`    ${instructions.length} instructions — programs: ${programs.join(", ")}`);

  const appFiles    = glob(join(ROOT, "app"),        [".ts", ".tsx"]);
  const serverFiles = glob(join(ROOT, "server/src"), [".ts"]);
  const rustFiles   = glob(join(ROOT, "anchor/programs"), [".rs"])
    .filter((f) => !f.includes("/target/"));
  const allTsFiles  = [...appFiles, ...serverFiles];

  const serverRoutes = extractServerRoutes(serverFiles);
  console.log(`    ${serverRoutes.length} server routes, ${allTsFiles.length} TS files, ${rustFiles.length} Rust files\n`);

  const edges = [];

  // ── Scan TS/TSX files ──────────────────────────────────────────────────
  for (const abs of allTsFiles) {
    const filePath = rel(abs);
    if (filePath.includes("/generated/") || filePath.endsWith(".d.ts")) continue;

    const content = readFileSync(abs, "utf-8");
    const lines   = content.split("\n");
    const bindings = extractStringBindings(lines); // data-flow: varName → literal

    for (let i = 0; i < lines.length; i++) {
      const line   = lines[i];
      const caller = getCallerContext(lines, i, filePath);

      // ── 1. Anchor: program.methods.X().rpc() ──────────────────────────
      // Single-line or multi-line (.methods\n  .X())
      const methodsMatch =
        line.match(/program\.methods\.(\w+)\s*\(/) ||
        (line.match(/^\s*\.([a-z]\w+)\s*\(/) &&
          lines.slice(Math.max(0, i - 4), i).some((l) => /program\.methods/.test(l)) &&
          line.match(/^\s*\.([a-z]\w+)\s*\(/));

      if (methodsMatch) {
        const camelName = (line.match(/program\.methods\.(\w+)\s*\(/) ?? line.match(/^\s*\.([a-z]\w+)\s*\(/))[1];
        const ix = instructions.find((x) => x.camelCase === camelName);
        if (ix) edges.push({
          type: "anchor_rpc", from: caller,
          via: `program.methods.${camelName}(...).rpc()`,
          idl_program: ix.program, idl_program_id: ix.programId,
          idl_instruction: ix.name, idl_accounts: ix.accounts,
          to: resolveRustHandler(ix), line: i + 1, confidence: "high",
        });
      }

      // ── 2. Anchor legacy: program.rpc.X() ─────────────────────────────
      const rpcMatch = line.match(/program\.rpc\.(\w+)\s*\(/);
      if (rpcMatch) {
        const camelName = rpcMatch[1];
        const ix = instructions.find((x) => x.camelCase === camelName);
        if (ix) edges.push({
          type: "anchor_rpc_legacy", from: caller,
          via: `program.rpc.${camelName}(...)`,
          idl_program: ix.program, idl_program_id: ix.programId,
          idl_instruction: ix.name, idl_accounts: ix.accounts,
          to: resolveRustHandler(ix), line: i + 1, confidence: "high",
        });
      }

      // ── 3. Anchor dynamic: program.methods[varName]() ─────────────────
      const dynMatch = line.match(/program\.methods\s*\[\s*(\w+)\s*\]\s*\(/);
      if (dynMatch) {
        const varName  = dynMatch[1];
        const resolved = bindings.get(varName); // data-flow lookup
        const camelName = resolved ?? varName;
        const ix = instructions.find((x) => x.camelCase === camelName);
        edges.push({
          type: "anchor_dynamic", from: caller,
          via: `program.methods[${varName}](...)`,
          ...(ix ? {
            idl_program: ix.program, idl_instruction: ix.name,
            idl_accounts: ix.accounts,
            to: resolveRustHandler(ix), confidence: "high",
          } : {
            to: `anchor::dynamic::${camelName}`,
            confidence: resolved ? "medium" : "low",
          }),
          line: i + 1,
        });
      }

      // ── 4. Anchor Kit: getXInstruction[Async]() ───────────────────────
      // Fix: (?:Async)? not Async? — whole word optional
      const kitMatch = line.match(/\bget([A-Z]\w+?)Instruction(?:Async)?\s*\(/);
      if (kitMatch) {
        const ix = instructions.find((x) => x.PascalCase === kitMatch[1]);
        if (ix) edges.push({
          type: "anchor_kit", from: caller,
          via: `get${kitMatch[1]}Instruction(...)`,
          idl_program: ix.program, idl_program_id: ix.programId,
          idl_instruction: ix.name, idl_accounts: ix.accounts,
          to: resolveRustHandler(ix), line: i + 1, confidence: "high",
        });
      }

      // ── 5. HTTP fetch() / axios ────────────────────────────────────────
      if (/fetch\s*\(|axios\s*\.\s*(get|post|put|delete|patch)\s*\(/.test(line)) {
        const urlInfo = extractFetchUrlPath(line, bindings);
        if (urlInfo) {
          const ctx    = lines.slice(i, Math.min(i + 6, lines.length)).join(" ");
          const method = ctx.match(/method:\s*["'](\w+)["']/)?.[1]?.toUpperCase() ??
            (line.match(/axios\s*\.\s*(get|post|put|delete|patch)/i)?.[1]?.toUpperCase()) ??
            "GET";
          const route = matchRouteToFetch(urlInfo.path, method, serverRoutes);
          edges.push({
            type: "http_call", from: caller,
            via: `fetch(${method} /${urlInfo.path})`,
            to: route
              ? routeHandlerName(route.file, method, route.pattern)
              : `server::${method}_${urlInfo.path.replace(/\//g, "_")}`,
            line: i + 1,
            confidence: route ? "high" : urlInfo.confidence === "medium" ? "medium" : "low",
          });
        }
      }

      // ── 6. useSWR(key, () => fn()) ─────────────────────────────────────
      // useSWR wraps a fetcher — emit edge to the function it calls
      const swrMatch = line.match(/useSWR\s*\(/);
      if (swrMatch) {
        // Look ahead up to 3 lines for the fetcher callback body
        const block = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
        // () => getPools() or async ([, , addr]) => client.rpc.X()
        const fetcherCall = block.match(/=>\s*(?:(?:{\s*)?(?:const\s+\w+\s*=\s*)?await\s+)?(\w+)\s*\./)?.[1]
          ?? block.match(/=>\s*(\w+)\s*\(/)?.[1];
        if (fetcherCall && !["null", "undefined", "true", "false"].includes(fetcherCall)) {
          // Try to resolve to a known internal target
          const target = INTERNAL_CALLS[fetcherCall]
            ?? [...appFiles, ...serverFiles]
              .map(rel)
              .find((fp) => fp.endsWith(`${fetcherCall}.ts`) || fp.endsWith(`${fetcherCall}.tsx`))
            ?? `app::${fetcherCall}`;
          edges.push({
            type: "swr_call", from: caller,
            via: `useSWR(() => ${fetcherCall}())`,
            to: target, line: i + 1, confidence: "medium",
          });
        }
      }

      // ── 7. Solana RPC: client.rpc.X().send() ──────────────────────────
      const rpcCallMatch = line.match(/client\.rpc\.(\w+)\s*\(/);
      if (rpcCallMatch) {
        edges.push({
          type: "solana_rpc", from: caller,
          via: `client.rpc.${rpcCallMatch[1]}(...).send()`,
          to: `solana_rpc::${rpcCallMatch[1]}`,
          line: i + 1, confidence: "high",
        });
      }

      // ── 8. WebSocket subscriptions ─────────────────────────────────────
      const wsMatch = line.match(/rpcSubscriptions\.(\w+)\s*\(/);
      if (wsMatch) {
        edges.push({
          type: "solana_subscribe", from: caller,
          via: `rpcSubscriptions.${wsMatch[1]}(...).subscribe()`,
          to: `solana_ws::${wsMatch[1]}`,
          line: i + 1, confidence: "high",
        });
      }

      // ── 9. Internal server calls ───────────────────────────────────────
      for (const [fnName, target] of Object.entries(INTERNAL_CALLS)) {
        if (new RegExp(`\\b${fnName}\\s*\\(`).test(line) &&
            !filePath.includes(target.split("::")[0])) {
          edges.push({
            type: "route_call", from: caller,
            via: `${fnName}(...)`, to: target,
            line: i + 1, confidence: "high",
          });
        }
      }
    }
  }

  // ── Scan Rust files for CPI ────────────────────────────────────────────
  for (const abs of rustFiles) {
    const fp = rel(abs);
    edges.push(...extractRustCpiEdges(abs, fp));
  }

  // ── Deduplicate ──────────────────────────────────────────────────────
  const seen = new Set();
  const deduped = edges.filter((e) => {
    const key = `${e.from}|${e.to}|${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  // ── Summary ──────────────────────────────────────────────────────────
  const types = ["anchor_rpc","anchor_rpc_legacy","anchor_dynamic","anchor_kit",
                 "http_call","swr_call","solana_rpc","solana_subscribe",
                 "route_call","rust_cpi"];
  const counts = Object.fromEntries(types.map((t) => [t, deduped.filter((e) => e.type === t).length]));

  const output = {
    generated_at: new Date().toISOString(),
    analyzer_version: "2.0.0",
    idl_programs: programs,
    summary: { total: deduped.length, ...counts },
    edges: deduped,
  };

  writeFileSync(join(ROOT, "anchor_edges.json"), JSON.stringify(output, null, 2));

  console.log("✅  Analysis complete!");
  for (const [t, n] of Object.entries(counts)) {
    if (n > 0) console.log(`    ${t.padEnd(20)} : ${n}`);
  }
  console.log(`    ${"─".repeat(26)}`);
  console.log(`    ${"total".padEnd(20)} : ${deduped.length}`);
  console.log("\n    Written → anchor_edges.json");

  // Print Anchor chains
  const anchorEdges = deduped.filter((e) => e.type.startsWith("anchor_rpc") || e.type === "anchor_kit" || e.type === "anchor_dynamic");
  if (anchorEdges.length) {
    console.log("\n📊  Anchor chains:");
    for (const e of anchorEdges) {
      console.log(`    [${e.type}] ${e.from.split("::").pop()}`);
      console.log(`      ──▶ IDL:${e.idl_program ?? "?"}::${e.idl_instruction ?? "?"} → ${e.to.split("::").pop()}`);
    }
  }

  const httpEdges = deduped.filter((e) => e.type === "http_call" || e.type === "swr_call");
  if (httpEdges.length) {
    console.log("\n📊  HTTP / SWR:");
    for (const e of httpEdges) {
      const badge = e.confidence === "high" ? "✓" : e.confidence === "medium" ? "~" : "?";
      console.log(`    [${badge}] ${e.from.split("::").pop()} → ${e.via}`);
    }
  }

  const rpcEdges = deduped.filter((e) => e.type === "solana_rpc" || e.type === "solana_subscribe");
  if (rpcEdges.length) {
    console.log("\n📊  Solana RPC / WebSocket:");
    for (const e of rpcEdges) {
      console.log(`    ${e.from.split("::").pop()} → ${e.via}`);
    }
  }

  const cpiEdges = deduped.filter((e) => e.type === "rust_cpi");
  if (cpiEdges.length) {
    console.log("\n📊  Rust CPI:");
    for (const e of cpiEdges) {
      console.log(`    ${e.from.split("::").pop()} → ${e.via}`);
    }
  }
}

analyze();
