# PreDataPool

**Solana-native, Cloudflare-style request coalescing for DePIN, IoT, and edge
compute.** When N agents on the same canonical request all need the same
public data, PreDataPool collapses them into one upstream fetch + one provider
payment, serves an encrypted-and-verifiable reuse to every other caller, and
settles paid reuse on Solana in a single batch.

Think of it as the *"fetch once, share N ways"* pattern Cloudflare gives
traditional web traffic — adapted for autonomous machines that pay for the
data they consume.

## Why this exists

The M2M economy is full of devices that independently ask for the *same*
public payload: a weather sensor swarm querying the same forecast, a fleet of
edge workers reading the same on-chain account, a DePIN cluster pulling the
same map tile. Each duplicate request burns:

- provider compute
- bandwidth
- rate-limit budget
- duplicate upstream payment (x402 / MPP / API key)
- downstream verification effort

Cloudflare solves this for web traffic with **request coalescing**: concurrent
requests for the same URL share a single origin fetch. PreDataPool does the
same thing for paid, verifiable M2M data — with Solana as the settlement and
provenance layer so reuse is auditable and providers still get paid for the
shared work.

## Coalescing model (honest framing)

The MVP coalesces at the **data layer**, not the literal HTTP layer:

- Same canonical request within a freshness window → same pool → same fetch.
- Concurrent callers join the pool and currently **poll for completion**
  (SDK fan-in / promise-sharing is a tracked TODO — see `AGENTS.md §5.3`).
- Settlement is genuinely batched: N off-chain signed receipts → 1 on-chain
  `settle_receipt` flow with compressed BuyerSlot leaves (Light Protocol).

So "coalescing" here describes the work-sharing semantics; the caller-side UX
is still poll-based until the SDK promise layer lands.

## What It Solves

Repeated requests for the same public API payload waste:

- provider compute
- bandwidth
- rate-limit budget
- duplicate payment flow
- downstream verification effort

PreDataPool pools that work around a canonical request key and reuses the
result while freshness still holds.

## MVP Scope

The first version is intentionally narrow:

- public, shareable machine-to-machine data
- IoT and edge telemetry
- weather, price, chain, and other public feeds
- canonical request deduplication
- AoI / freshness-window cache reuse
- encrypted payload storage
- buyer-side decrypt and verification
- Solana settlement primitives
- x402 or mock upstream payment flow

Out of scope for the first MVP:

- private or user-specific data
- trading-critical low-latency strategies
- full provider marketplace economics
- mainnet production claims
- mandatory Light Protocol compression on every path

## Core Flow

```
┌─────────────────────────────────────────────────────┐
│                   AGENT A                           │
│  1. Make the API request on the normal path         │
│  2. SDK hook: send the data + envelope to the pool  │
└────────────────┬────────────────────────────────────┘
                 │ DataEnvelope (imzali)
                 ▼
┌─────────────────────────────────────────────────────┐
│              PreDataPool Node                       │
│  - AoI-aware cache in RAM/Redis                    │
│  - canonical request key                           │
│  - encrypted payload at rest                       │
│  - expiry / signature verification                 │
│  - Merkle proof verification                       │
│  - TTL: τ_decay (based on data type)               │
│  - Solana micro-settlement record                  │
└────────────────┬────────────────────────────────────┘
                 │ cache hit
                 ▼
┌─────────────────────────────────────────────────────┐
│                   AGENT B                           │
│  1. Query the pool first                            │
│  2. Cache hit → verify → use → share payment        │
│  3. Cache miss → fetch API directly → report pool   │
└─────────────────────────────────────────────────────┘
```

On a cache miss:

1. The pool computes the canonical request key.
2. It fetches upstream once through x402, mock payment, or free mode.
3. It hashes raw bytes, encrypts the payload, and records `DataEnvelope`
   metadata.
4. It stores the envelope only while freshness is valid.
5. It settles reuse metadata for later buyers.

On a cache hit:

1. The node checks expiry and envelope metadata.
2. The buyer must be authorized before key delivery.
3. The buyer receives the wrapped key and encrypted payload.
4. The buyer decrypts locally and verifies the hash/root again.

Future SDK relay must be non-blocking: the agent fetch path must not wait for
pool relay completion.

## Important Docs

Development agents must read `AGENTS.md` and `CODEX_GUIDE.md` first.
Protocol assumptions must be checked against local docs in `docs/external/`.

Key local references:

- `docs/external/x402/client-server.md`
- `docs/external/x402/facilitator.md`
- `docs/external/anchor/solana-pda.md`
- `docs/external/anchor/account-constraints.md`
- `docs/external/noble/noble-ciphers-README.md`
- `docs/external/noble/noble-curves-README.md`
- `docs/external/light-protocol/*`

## Project Layout

```
anchor/   Solana Anchor program
server/   matcher, fetcher, cache, keeper glue
app/      Next.js frontend and debug console
docs/     local external protocol references
```

## Architecture: On-Chain Accounts vs. Off-Chain Efficiency

### One PDA per data request, not per buyer

A Pool PDA is keyed by `hash(endpoint + params + freshnessWindow)`. Six agents
requesting Istanbul weather open **one** on-chain account, not six. The same
PDA is reused across every future request for that endpoint until it expires.

### Buyer joins are fully off-chain

Buyers never submit individual transactions. Each buyer signs an ed25519
receipt locally. The keeper accumulates receipts and settles them in a single
`settle_batch` transaction — N buyers, 1 on-chain tx.

```
buyer-1  →  signed receipt (off-chain)  ─┐
buyer-2  →  signed receipt (off-chain)  ─┤──▶  settle_batch tx  (1 tx total)
buyer-N  →  signed receipt (off-chain)  ─┘
```

### The on-chain account is a trust anchor, not a payment rail

The Pool PDA stores:
- `data_hash` — SHA-256 of the fetched payload (tamper-proof)
- `key_commitment` — hash of the AES encryption key (verifiable)
- `storage_uri` — where buyers fetch the payload (no server trust needed)

Without this anchor the system degrades to "trust the server". The account is
the only part that requires chain state.

### Known limitations in the current MVP

| Issue | Impact | Fix |
|---|---|---|
| `initialize_pool` is eager | Opens an account on the first request, before threshold is confirmed | Make it lazy — initialize only when fetch is triggered |
| No Light Protocol compression yet | Each pool account costs ~0.002 SOL rent | Compressed accounts reduce this to ~0.000003 SOL (600×) |
| `settle_batch` not wired end-to-end | Off-chain receipt accumulation exists in `batch.ts` / `receipt.ts` but settlement loop is not complete | Wire keeper drain loop to `settle_receipt` instruction |

The core efficiency claim — one upstream fetch shared across N buyers — is
implemented and demonstrated. The on-chain overhead per pool is a known
cost to be compressed via Light Protocol in the next milestone.

## Development Note

This repository is still being reduced from a broader prototype into a narrow
MVP for M2M, IoT, and edge reuse. Treat README claims as product intent, not
production readiness.
