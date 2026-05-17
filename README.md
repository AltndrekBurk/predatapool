# PreDataPool

**Solana-native, Cloudflare-style request coalescing for DePIN, IoT, and edge
compute.** When N agents on the same canonical request all need the same
public data, PreDataPool collapses them into one upstream fetch + one provider
payment, serves an encrypted-and-verifiable reuse to every other caller, and
settles paid reuse on Solana using compressed accounts via Light Protocol.

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

## Coalescing model

Three production layers active today:

- **Data layer (`server/src/matcher.ts`):** Same canonical request within a
  freshness window → same pool hash → same encrypted payload. The matcher
  uses the SDK's `hashRequestV2` (SHA-256 over a stable canonical request:
  provider id, HTTP method, host+path, normalized params, freshness window)
  and dedups against a SQLite-backed `PoolStore`.
- **Server-side singleflight (`server/src/index.ts:120` ─ `sdk/src/coalesce.ts:19`):**
  N concurrent `POST /request` callers that cross the fetch threshold for
  the same pool share ONE in-flight `runFetchPipeline` Promise via the
  SDK's `Singleflight`. The entry is cleared on settle (success OR
  failure), so retries after failure are independent.
- **Settlement (`server/src/scheduler.ts` + `server/src/keeper.ts`):** Buyers
  POST off-chain Ed25519-signed `JoinReceipt`s; the scheduler drains the
  per-pool queue every `SETTLE_INTERVAL_MS` (default 5s) and submits one
  `settle_receipt` transaction per receipt. Each `settle_receipt` writes a
  compressed `BuyerSlot` leaf via Light Protocol — no per-buyer rent-paying
  account.

**What is still poll-based:** the buyer UI (`app/components/pool-card.tsx`)
uses `useSWR` with `refreshInterval: 5_000` to poll
`GET /pool/:hash/metadata` until `status === "fetched"` before asking for
the wrapped K_pool. A blocking `?wait=true` variant of `/request` is not
implemented today.

## MVP Scope

In scope:

- public, shareable machine-to-machine data
- canonical request deduplication keyed by (provider, method, host+path,
  normalized params, freshness window)
- AoI / freshness-window cache reuse
- AES-256-GCM encrypted payload storage at rest
- ECIES (x25519 + HKDF-SHA256 + AES-GCM) wrapped key delivery, gated by
  on-chain `BuyerSlot` membership
- DataEnvelope v0 (SHA-256 root + keeper Ed25519 signature) verified by
  buyers
- exponential AoI time-decay pricing, off-chain (`Math.exp`) and on-chain
  (`exp_neg_q16`, Q16.16) in agreement to <0.5%
- compressed `BuyerSlot` leaves via Light Protocol — replay protection by
  deterministic leaf address `["buyer_slot", pool, buyer]`
- x402 / MPP upstream payment via `@solana/mpp/client`, free, or
  API-key-bearer fetch modes
- provider-side time-decayed revenue share, claimable incrementally
- sponsor (pre-fetch buyer) retroactive rebates

Out of scope for the first MVP:

- private or user-specific data (the matcher rejects endpoints with
  userinfo or sensitive param names)
- trading-critical low-latency strategies
- on-chain provider registry (today's `server/src/providers.ts` is an
  in-memory hostname → agreement map)
- mainnet production claims
- Redis (the store is `better-sqlite3`)
- a blocking `/request?wait=true` mode

## Core Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ AGENT A, B, …, N — POST /request                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │ canonical key:
                        │ hashRequestV2(provider, method,
                        │   host+path, normalized params,
                        │   freshness_window_secs)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ PreDataPool Node (Express)                                      │
│  - matcher.joinPool: pool dedup (SQLite)                        │
│  - threshold met? (buyers ≥ minBuyers OR age ≥ 60s)             │
│  - Singleflight collapses concurrent triggers → 1 pipeline      │
│  - lazy runFetchPipeline:                                       │
│      1. initialize_pool        (Anchor, only on threshold)      │
│      2. fetch upstream         (free / apiKey / mpp)            │
│      3. AES-256-GCM encrypt    (K_pool generated server-side)   │
│      4. trigger_fetch          (writes data_hash on-chain)      │
│      5. register_dataset       (storage_uri, key_commitment,    │
│                                 source_hash, merkle_root,       │
│                                 keeper_signature, expires_at)   │
│      6. markFetched off-chain  (status=fetched)                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │ buyers POST signed JoinReceipt
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ scheduler.tickSettle (every SETTLE_INTERVAL_MS, default 5s)     │
│  - drain pending receipts per pool                              │
│  - settle_receipt tx per receipt:                               │
│      • Ed25519Program verify ix proves buyer authorization      │
│      • protocol_delegate PDA pulls current_price(now) USDC      │
│      • Light Protocol CPI writes compressed BuyerSlot leaf      │
│  - addAuthorizedBuyer off-chain → buyer can now request K_pool  │
└───────────────────────┬─────────────────────────────────────────┘
                        │ POST /pool/:hash/key (signed by buyer)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Buyer pulls ciphertext + IV, gets ECIES-wrapped K_pool,         │
│ asserts keyCommitment, decrypts, verifies DataEnvelope          │
│ (root + keeper sig) and SHA-256(payload) == on-chain data_hash. │
└─────────────────────────────────────────────────────────────────┘
```

## Project Layout

```
anchor/        Solana Anchor program (`datapool`)
  programs/datapool/src/
    lib.rs                    instruction entry points + Light CPI signer
    state.rs                  DataPool, CompressedBuyerSlot, exp_neg_q16
    receipt.rs                JoinReceipt + Ed25519 ix sysvar parsing
    error.rs                  DataPoolError variants
    instructions/             trigger_fetch, register_dataset,
                              settle_receipt, claim_rebate,
                              claim_provider_revenue
server/        Off-chain pool node (Express)
  src/
    index.ts                  HTTP routes + Singleflight at the fetch boundary
    matcher.ts                joinPool, isReusable, buildPoolMetadata
    store.ts                  PoolStore (better-sqlite3, SCHEMA_VERSION=5)
    fetcher.ts                free / apiKey / mpp upstream fetch
    crypto.ts                 K_pool, AES-256-GCM, ECIES x25519 wrap
    envelope.ts               DataEnvelope v0 builder
    decay.ts                  currentPrice + lambdaToQ16
    providers.ts              endpoint → ProviderAgreement registry
    batch.ts                  per-pool receipt queue, freshness, replay
    receipt.ts                JoinReceipt canonical serialization
    keeper.ts                 Anchor program calls (initialize_pool,
                              trigger_fetch, register_dataset,
                              settle_receipt, claim_*)
    light.ts                  Photon RPC + PackedAccounts for Light CPI
    scheduler.ts              tickSettle, tickPrune, recoverStuckFetching
    mock-upstream.ts          MPP-charging demo upstream on :4001
    scripts/                  claim-provider-revenue, claim-rebate CLIs
sdk/           `@predatapool/sdk` — shared client + protocol primitives
  src/
    index.ts                  public exports
    coalesce.ts               Singleflight<T>
    request-key.ts            hashRequestV2, buildCanonicalRequest
    client.ts                 PoolClient (typed wrapper over HTTP API)
    crypto.ts                 buyer-side ECIES unwrap, decrypt, verify
    envelope.ts               buildDataEnvelopeV0, verifyDataEnvelopeV0
    receipt.ts                serializeReceipt (104-byte canonical form)
    types.ts                  Pool, PoolMetadata, RequestResponse, …
app/           Next.js 16 frontend (wallet UI, request form, pool cards)
  components/                 pool-card.tsx, datapool-request-form.tsx, …
  lib/                        wallet, crypto, server-api, hooks
examples/      runnable demos
  coalescing-demo.ts          Singleflight smoke test (no network)
  devnet-demo.ts              6 agents → 1 upstream fetch on devnet
docs/external/ vendored protocol references (x402, Anchor, noble, Light)
```

`server` and `sdk` are npm workspaces under the root `package.json`.

## HTTP API (server)

| Method | Path                       | Purpose                                        |
|--------|----------------------------|------------------------------------------------|
| POST   | `/request`                 | Submit a request; join or create a pool        |
| GET    | `/pool/:hash`              | Raw pool record                                |
| GET    | `/pool/:hash/metadata`     | Versioned read-side view (`v: 2`)              |
| GET    | `/pool/:hash/payload`      | Encrypted bytes + `X-DataPool-*` envelope hdrs |
| POST   | `/pool/:hash/key`          | ECIES-wrapped K_pool for an authorized buyer   |
| POST   | `/receipt`                 | Submit a signed `JoinReceipt` to the batch     |
| GET    | `/pool/:hash/batch`        | Inspect pending receipts for a pool            |
| GET    | `/pools`                   | List all pools                                 |
| GET    | `/batches`                 | Pools with pending receipts                    |
| GET    | `/health`                  | Health check                                   |

Boot-time required env vars (outside `NODE_ENV=test`, see `validateEnv` in
`server/src/index.ts`):

- `SERVER_BASE_URL` — published on-chain as the `storage_uri` base.
- `PHOTON_RPC_URL` — Photon-compatible endpoint for Light Protocol CPIs.
  `settle_receipt` and `claim_rebate` cannot run without one.

Other env vars: `SOLANA_RPC_URL`, `PROGRAM_ID`, `KEEPER_KEYPAIR_PATH`,
`USDC_MINT`, `DATAPOOL_STORE_PATH`, `SETTLE_INTERVAL_MS`,
`PRUNE_INTERVAL_MS`, `WEATHERXM_API_KEY`, `HIVEMAPPER_API_KEY`,
`*_PROVIDER_PUBKEY`.

## On-chain program

Program ID: `62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D` (Anchor 0.32.1,
devnet). USDC mint default: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

Instructions in `anchor/programs/datapool/src/lib.rs`:

- `initialize_pool` — create the `DataPool` PDA (`["data_pool", request_hash]`)
  and the escrow token account (`["escrow", request_hash]`) under an
  `escrow_authority` PDA. Stores buyer-side `λ` and provider-side `λ` as
  Q16.16 per-hour; rejects `λ > 1000/hr` and `provider_share + 3000 > 10000`.
  Called lazily by the keeper from `runFetchPipeline` only when the
  off-chain threshold is met.
- `trigger_fetch` — keeper records `data_hash` and `fetched_at_ms`. Pool
  becomes priced under exponential decay (`exp_neg_q16`).
- `register_dataset` — keeper publishes `storage_uri` (≤128 chars),
  `key_commitment`, `source_hash`, `expires_at_ms`, `merkle_root`, and
  `keeper_signature`. Non-replayable: rejects if `storage_uri` is already
  set.
- `settle_receipt` — settles ONE signed `JoinReceipt` per tx. The
  preceding Ed25519Program ix proves buyer authorization; the program
  reads the instructions sysvar to confirm. Funds flow via a single
  protocol-wide `protocol_delegate` PDA (`["protocol_delegate"]`) that
  every buyer pre-approves on their USDC ATA once. Writes a compressed
  `BuyerSlot` leaf via Light Protocol — the deterministic address
  `["buyer_slot", pool, buyer]` doubles as replay protection (a second
  insert at the same address is rejected by the Light system program).
- `claim_provider_revenue` — provider pulls their marginal entitlement
  (`provider_share_bps_now(t) * post_fetch_revenue / 10000 − provider_paid`).
  Callable repeatedly as new buyers join.
- `claim_rebate` — sponsor (pre-fetch buyer) pulls a retroactive rebate
  out of post-fetch revenue (`REBATE_SHARE_BPS = 3000`, i.e. 30%). Reads
  the sponsor's existing compressed `BuyerSlot` leaf, mutates
  `rebate_claimed` and `rebate_amount`; double-claim is rejected by
  Light's "burn old leaf, insert new leaf" semantic.

`anchor/programs/datapool/src/state.rs` is the single source of truth for
`DataPool` field layout and the `Q16.16` `exp_neg_q16` polynomial. The
off-chain `server/src/decay.ts:currentPrice` and on-chain
`DataPool::current_price` agree within 0.5% across the meaningful range
(verified in `server/src/decay.test.ts`).

## Cryptography

- **Pool key**: 32-byte random `K_pool` per pool. Lives server-side; buyers
  only ever see ECIES wraps.
- **Payload at rest**: `AES-256-GCM(K_pool, plaintext, iv=random96)`,
  ciphertext + 16-byte GCM tag concatenated; 12-byte IV stored alongside.
- **Key commitment**: `SHA-256("DATAPOOL_K_V1" || K_pool)` — published
  on-chain in `register_dataset`. Buyers verify the K_pool they unwrap
  against it.
- **Key wrap (ECIES)**: ephemeral x25519 keypair, `HKDF-SHA256(shared,
  salt=eph_pub, info="DATAPOOL_WRAP_V1", L=32)`, `AES-256-GCM(wrap_key,
  K_pool, iv=0)`. Total wire form: 32-byte `eph_pub` || 48-byte blob =
  80 bytes.
- **Buyer x25519 derivation**: HKDF over the wallet's Ed25519 signature of
  the constant message `DATAPOOL_X25519_DERIVE_V1:enc-key-derivation`,
  with info `"DATAPOOL_X25519_V1"`. Deterministic per wallet.
- **`/pool/:hash/key` request**: buyer signs the 80-byte message
  `"DATAPOOL_KEYREQ_V1" || pool_hash(32) || encPubkey(32) || nonce(8 BE)`.
  Server enforces per-(pool, buyer) nonce uniqueness and
  `authorizedBuyers.includes(buyer)` (which is set only after
  `settle_receipt` succeeds on-chain).
- **DataEnvelope v0**: `merkle_root = SHA-256(payload || source_url ||
  fetched_at_ms(BE u64) || expires_at_ms(BE u64))`; keeper Ed25519 signs
  the root. Buyers recompute the root from headers + plaintext and verify
  the keeper signature before trusting the payload.
- **JoinReceipt**: 104 canonical bytes — `"DATAPOOL_JOIN_V1"(16) ||
  pool_hash(32) || buyer(32) || max_price(u64 LE) || nonce(u64 LE) ||
  deadline(i64 LE)`. Buyer signs with Ed25519; server tolerates any
  prefix as long as the trailing 104 bytes match.

## Time-decay pricing

```
price(t)        = base_price · exp(-λ · Δhours), floor 1 micro-USDC
provider_share(t) bps = provider_share_bps · exp(-λ_provider · Δhours)
```

- Off-chain: `Math.exp` in `server/src/decay.ts`.
- On-chain: `state.rs:exp_neg_q16` — range-reduction `x = k·ln2 + r`,
  degree-5 minimax polynomial in Horner form, divide by `2^k` via right
  shift. Saturates to 0 at `x ≥ 21`. Verified against `Math.exp` at
  `x ∈ {0, ln2, 1, 5, 10}` with relative error <5e-5.
- `λ` is stored as `lambda_q16_per_hour: u32` (Q16.16). Keeper converts
  via `decay.lambdaToQ16` at `initialize_pool`; cap is `λ ≤ 1000/hr`
  (`q ≤ 65_536_000`).

`server/src/providers.ts` ships agreements for `api.weatherxm.com` and
`hivemapper-api.com` (API-key fetch), plus `localhost:4001` (MPP fetch
against `server/src/mock-upstream.ts`). Unknown endpoints fall back to a
free fetch with `λ = 0.05/hr`, `minBuyers = 2`, 5-minute freshness.

## Storage & scheduler

- `server/src/store.ts` is a `better-sqlite3` `PoolStore`. Tables:
  `pools` and `payloads` (CASCADE on pool delete), plus a `schema_meta`
  table that drops + recreates both tables on `SCHEMA_VERSION` mismatch
  (cache is rebuildable from the upstream, so no row-shape migrations).
- `scheduler.tickSettle` (every `SETTLE_INTERVAL_MS`, default 5s) drains
  pending receipts per pool and submits each as one `settle_receipt`
  transaction. On success it calls `addAuthorizedBuyer` — that gates
  `POST /pool/:hash/key`.
- `scheduler.tickPrune` (every `PRUNE_INTERVAL_MS`, default 30s) drops
  pools and payloads with `expires_at < now`.
- `scheduler.recoverStuckFetching` runs once on boot: pools left in
  `fetching` from a previous run are reset to `pending` (or `closed` if
  past `expires_at`) so the next request can re-trigger.

## Running locally

```bash
# install workspaces (root, server, sdk)
npm install

# build the SDK once (server/app depend on it)
npm run sdk:build

# build the Anchor program (requires anchor + cargo)
npm run anchor-build

# regenerate the Codama JS client (uses anchor/target/idl/datapool.json)
npm run codama:js

# start the pool node (set SERVER_BASE_URL + PHOTON_RPC_URL first)
npm run server:dev

# start the Next.js frontend
npm run dev

# (optional) mock MPP-charging upstream on :4001
MOCK_RECIPIENT_PUBKEY=<your_wallet> \
  npm run -w datapool-server mock-upstream

# coalescing smoke test — 10 callers, 1 underlying invocation
npx tsx examples/coalescing-demo.ts

# devnet end-to-end — 6 agents → 1 upstream fetch
npx tsx examples/devnet-demo.ts
```

Tests:

```bash
npm run sdk:test          # @predatapool/sdk node:test suite
npm run server:test       # server node:test suite
npm run anchor-test       # cargo test inside anchor/
```

## Important docs

`AGENTS.md` and `CODEX_GUIDE.md` are the binding rules for development
agents — read them first. Local protocol references are vendored under
`docs/external/`:

- `docs/external/x402/client-server.md`, `facilitator.md`, `http-402.md`
- `docs/external/anchor/account-constraints.md`, `solana-pda.md`,
  `solana-cpi.md`, `solana-tokens.md`
- `docs/external/noble/noble-ciphers-README.md`,
  `noble-curves-README.md`, `noble-hashes-README.md`
- `docs/external/light-protocol/*`

External memory or generic best practices do not override these vendored
docs and the current code.

## Development note

This repository is still being reduced from a broader prototype into a
narrow MVP. Treat README claims as a snapshot of what the code does
today, not as production-readiness or mainnet endorsement.
