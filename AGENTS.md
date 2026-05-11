# AGENTS.md — PreDataPool Development Guide

This file governs Codex and any AI coding agent working on this repository.
Read it before touching code, config, tests, or documentation.

## 0. Prime Directive

Never assume. Never guess. Never fabricate.

If any of these are uncertain, stop and ask:

- x402, MCP, Solana runtime, Anchor, or Light Protocol behavior
- account layouts or data schemas
- cryptographic primitive usage
- on-chain settlement or revenue logic
- provider permission / opt-in rules
- whether a data source is public and pool-eligible

Uncertainty is acceptable. Proceeding despite uncertainty is not.

## 1. Current Repository Shape

The user may describe the target architecture as `/sdk`, `/node`, and
`/programs/predatapool`. That is the desired direction, not the current tree.

Current paths:

| Component | Current Location | Notes |
|---|---|---|
| Frontend / read client | `app/` | Next.js, wallet UI, buyer decrypt/verify helpers |
| Pool server / keeper | `server/` | Express, matcher, fetcher, SQLite store |
| On-chain program | `anchor/programs/datapool` | Anchor/Rust |
| Local references | `docs/external/` | Must be read before protocol decisions |

Do not invent missing folders or rewrite the repo layout unless explicitly asked.

## 2. What This Project Is

PreDataPool is a Solana-native public data reuse layer for machine-to-machine
payments. It groups identical or overlapping requests from AI agents, IoT
devices, vehicles, and edge devices; performs one verified fetch when possible;
serves encrypted reuse; and records paid reuse on Solana.

MVP scope:

- public/shareable data only
- canonical request deduplication
- one upstream fetch/payment per fresh pool
- encrypted at-rest payload cache
- buyer-side decrypt + SHA-256 verification
- x402/mock upstream demo
- Solana devnet settlement primitives

Out of scope for MVP:

- private/user-specific data
- generic provider marketplace
- mainnet production claims
- full Redis migration
- mandatory Light Protocol on every path
- every possible data category

## 3. Core Concepts

### DataEnvelope

Target signed data unit:

```ts
type DataEnvelope = {
  payload: Uint8Array;
  source_url: string;
  fetched_at: number; // unix ms
  expires_at: number; // fetched_at + tau_decay
  merkle_root: Uint8Array; // SHA256(payload || source_url || fetched_at || expires_at)
  provider_sig?: Uint8Array; // Ed25519, only if provider is opted in
  keeper_sig: Uint8Array; // Ed25519
};
```

Current MVP may start with `data_hash` + `key_commitment`, but any new design
must move toward this envelope. Provider signatures must not be claimed until
provider opt-in exists and is verified.

### Time Decay / AoI

Freshness is based on Age of Information:

```text
valid(t) = t < fetched_at + tau_decay
freshness_score(t) = exp(-lambda * (t - fetched_at))
```

The current code may use linear decay. Do not change the model without updating
this file and `CODEX_GUIDE.md`.

### Revenue Split

Revenue split is protocol state, not SDK/server folklore:

```text
R_provider = pool_fee * provider_ratio
R_fetcher  = pool_fee * fetcher_ratio
R_protocol = pool_fee * protocol_ratio
```

Ratios must come from on-chain config or clearly versioned protocol metadata.
Do not hardcode business ratios in SDK/client code.

## 4. Mandatory Local References

Always check local docs before implementing or judging a protocol behavior.

| Topic | Read First |
|---|---|
| x402 client/server flow | `docs/external/x402/client-server.md` |
| x402 facilitator / duplicate settlement | `docs/external/x402/facilitator.md` |
| HTTP 402 semantics | `docs/external/x402/http-402.md` |
| Anchor constraints | `docs/external/anchor/account-constraints.md` |
| PDA / canonical bump | `docs/external/anchor/solana-pda.md` |
| CPI | `docs/external/anchor/solana-cpi.md` |
| SPL token / USDC | `docs/external/anchor/solana-tokens.md` |
| AES-GCM | `docs/external/noble/noble-ciphers-README.md` |
| Ed25519 / X25519 | `docs/external/noble/noble-curves-README.md` |
| SHA-256 / HKDF | `docs/external/noble/noble-hashes-README.md` |
| Light compression | `docs/external/light-protocol/*` |

External memory, blog knowledge, or generic best practices do not override
local docs and current code.

## 5. Non-Negotiable Rules

### 5.1 No Assumptions

- Do not assume API response schema unless documented or read from code/tests.
- Do not assume Solana account layout unless defined in `state.rs`.
- Do not assume cache key naming unless defined in `server/src/store.ts` or `server/src/matcher.ts`.
- Do not assume provider opt-in status. If no registry exists, say so.
- Do not claim Redis behavior while the current store is SQLite.

### 5.2 Cryptographic Correctness

- Use Ed25519 for Solana keypair signatures.
- Use SHA-256 for payload hashes and envelope roots.
- Never skip envelope/hash/key verification.
- Never serve a cache hit as "verified" unless:
  1. hash/root recomputation matches
  2. required signature checks pass
  3. `expires_at > Date.now()`
- If verification fails, reject and log. Do not fall back to unverified data.
- Tests for crypto must use real keys and real verification, not mocked success.

### 5.3 Latency Constraint

Future SDK relay to the pool must be asynchronous and non-blocking. The agent's
critical path must not wait for relay completion.

```ts
const response = await fetch(url, options);
pool.relay(buildEnvelope(response)).catch((err) => logger.error("relay failed", { err }));
return response;
```

Do not write SDK logic that blocks the caller's fetch response on pool relay
unless the user explicitly asks for a blocking mode.

### 5.4 On-Chain Rules

- Revenue ratios are read from on-chain config or versioned protocol metadata.
- Provider opt-in must eventually be on-chain or cryptographically verifiable.
- Use Anchor `#[error_code]` for custom errors.
- Instructions should be idempotent where the protocol allows it.
- Account additions require updates to initialization, tests, generated clients,
  and docs in the same change.

### 5.5 Cache / Pool Node Rules

Current implementation uses SQLite. Redis is a future target unless introduced
explicitly.

- TTL must be set from `expires_at - Date.now()`.
- If TTL <= 0, do not store.
- Do not overwrite a fresh envelope/payload with an older one.
- Public pool cache keys must not include secrets or raw credentials.
- A future Redis implementation should use NX-style writes for fresh records.

## 6. Prohibited Actions

| Prohibited Action | Reason |
|---|---|
| Hardcode private keys or seeds | Security |
| Serve cache hit without verification | Data integrity |
| Block SDK fetch path for relay | Latency |
| Assume provider permission | Protocol correctness |
| Use `any` in SDK/client code | Type safety |
| Mock cryptographic verification as passing | False confidence |
| Modify revenue ratios outside protocol config | Single source of truth |
| Store API keys or credentials in DataEnvelope | Privacy |
| Use `innerHTML` for user data | XSS |
| Write plaintext payloads to SQLite/cache | Confidentiality |

## 7. Data Categories

Do not invent new categories without documenting them here and in
`CODEX_GUIDE.md`.

| Category | tau_decay | lambda | Example |
|---|---:|---:|---|
| `price.realtime` | 2s | 1.5 | CEX/DEX tickers |
| `price.ohlc` | 60s | 0.05 | OHLC feeds |
| `weather.current` | 300s | 0.01 | Open-Meteo, NOAA |
| `weather.forecast` | 3600s | 0.001 | hourly forecast |
| `chain.block` | 400ms | 5.0 | Solana slot data |
| `chain.account` | 5s | 0.5 | on-chain account state |
| `iot.sensor` | 10s | 0.2 | edge sensor reading |
| `reference.static` | 86400s | 0.00001 | metadata/company data |

If the category is not listed, ask before assigning decay.

## 8. Error Handling

Every async path must handle errors explicitly. No silent failures.

Structured rejection logs should include:

- timestamp
- reason enum: `EXPIRED`, `INVALID_SIG`, `MERKLE_MISMATCH`,
  `PROVIDER_NOT_OPTED_IN`, `NOT_PUBLIC`, `SCHEMA_UNKNOWN`
- hashed source URL, not raw if sensitive
- envelope or pool id

Production paths should use a structured logger when available. If no logger
exists yet, note that before adding broad logging.

## 9. Testing Requirements

- Crypto operations need valid, expired, tampered payload, and missing signature tests.
- Solana program tests must use real runtime tooling, not mocked runtime behavior.
- Pool cache tests must cover TTL <= 0 and stale overwrite prevention.
- If the user says "do not run code", do not run test/build/dev commands.

## 10. Frontend / Product Constraints

- Build the working product screen, not a marketing landing page.
- UI must not claim features that do not exist.
- Show the demo flow clearly: request, pool status, cache hit, verify, payment/receipt.
- Avoid nested cards and generic AI-gradient styling.
- Text must fit on mobile and desktop.

## 11. Stop And Ask

Stop and ask before proceeding if:

- on-chain schema changed and TS types may be stale
- a new data category is needed
- provider opt-in flow changes
- revenue split ratios need changing
- crypto dependencies or primitives change
- tests fail due to Solana/runtime version mismatch
- deleting or overwriting schema/docs files is required

## 12. Commit Convention

```text
<type>(<scope>): <short description>

types: feat | fix | test | docs | refactor | chore
scopes: app | server | anchor | sdk | docs | config
```

Example:

```text
feat(server): add keeper-signed data envelope
fix(anchor): reject stale receipt settlement
docs(protocol): document public-data MVP flow
```

Last updated: May 2026.
