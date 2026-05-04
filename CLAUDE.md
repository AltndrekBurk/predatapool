# DataPool Protocol — Project Context for Claude Code

## What This Project Does

DataPool is a Solana-native buyer-side demand pooling protocol for IoT/DePIN/API data.

**Core mechanism:**
1. Multiple buyers request the same data (weather, GPS, maps, sensor readings)
2. Their requests are deduplicated by a canonical hash off-chain
3. The data is fetched **once** (via x402 or direct HTTP) and split among buyers
4. Later buyers pay a **time-decayed price** (cheaper as data ages)
5. Post-fetch buyer revenue is routed back to early sponsors as **retroactive rebates**

## Architecture

```
datapool-protocol/
  anchor/                         ← Solana programs (Anchor 0.32.1)
    programs/
      datapool/src/
        lib.rs                    ← Program entry + InitializePool
        state.rs                  ← DataPool, BuyerSlot account structs
        error.rs                  ← Custom error codes
        instructions/
          join_pool.rs            ← Buyer deposits USDC → escrow
          trigger_fetch.rs        ← Keeper authorizes data fetch
          register_dataset.rs     ← On-chain hash + timestamp registry
          claim_rebate.rs         ← Early sponsor claims USDC rebate
  server/                         ← Off-chain matching server (Node.js)
    src/
      index.ts                    ← HTTP API (POST /request, GET /pools)
      matcher.ts                  ← Request deduplication + pool formation
      fetcher.ts                  ← x402 / HTTP data fetch layer
      decay.ts                    ← Time-decay pricing engine
  app/                            ← Next.js 14 frontend (pool UI, dashboard)
```

## Key Concepts

### DataPool Account (PDA)
- Seeds: `["data_pool", request_hash]`
- Holds: escrow reference, buyer count, fetch timestamp, data hash, decay config
- State machine: `open → fetching → fetched → (stays open for post-fetch buyers)`

### BuyerSlot Account (PDA)
- Seeds: `["buyer_slot", pool_pubkey, buyer_pubkey]`
- Tracks: amount paid, is_sponsor (pre-fetch), rebate_claimed, rebate_amount

### Time-Decay Formula
```
price = base_price * max(0, 10000 - decay_bps * hours_elapsed) / 10000
floor: 1 micro-USDC
```

### Rebate Invariant (CRITICAL — must never be violated)
```
total_distributed ≤ total_collected
```
This is checked on-chain in claim_rebate.rs before every transfer.

### Decay Presets (server/src/decay.ts)
| Data Type    | Base Price  | Decay Rate   |
|-------------|-------------|--------------|
| weather     | $0.10 USDC  | -1%/hr       |
| gps_rtk     | $0.50 USDC  | -6.67%/hr    |
| map_imagery | $0.05 USDC  | -0.01%/hr    |
| iot_sensor  | $0.01 USDC  | -2%/hr       |
| api_response| $0.05 USDC  | -5%/hr       |

## Development Commands

```bash
# Anchor program
cd anchor
anchor build                    # Compile programs
anchor test                     # Run LiteSVM tests
anchor deploy --provider.cluster devnet

# Matching server
cd server
npm run dev                     # Start with hot reload (tsx watch)
curl -X POST localhost:3001/request -H 'Content-Type: application/json' \
  -d '{"endpoint":"https://api.weatherxm.com/...","buyerPubkey":"..."}'

# Frontend
npm run dev                     # Next.js dev server (root)
```

## Environment Variables

```bash
# server/.env
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
KEEPER_KEYPAIR_PATH=~/.config/solana/id.json
WEATHERXM_API_KEY=optional
HIVEMAPPER_API_KEY=optional

# app/.env.local
NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_PROGRAM_ID=DPoo1111111111111111111111111111111111111111
```

## Current Status

- [x] Anchor program: state + 5 instructions written
- [x] Off-chain server: matcher + fetcher + decay engine
- [ ] Anchor program: compile + test with LiteSVM
- [ ] Server: on-chain integration (keeper keypair → trigger_fetch CPI)
- [ ] Frontend: pool UI + rebate dashboard
- [ ] Devnet deployment + end-to-end test

## Security Notes

1. **Rebate accounting**: `total_distributed ≤ total_collected` checked on every claim
2. **Sybil protection**: `BuyerSlot` init with `init` constraint — one slot per wallet per pool
3. **Keeper authorization**: `trigger_fetch` + `register_dataset` gated by `pool.keeper == keeper.key()`
4. **Escrow ownership**: escrow token account owned by `escrow_authority` PDA — not the keeper

## Next Steps

Run `/build-with-claude` for guided implementation of remaining features.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
