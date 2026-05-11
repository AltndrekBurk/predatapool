# PreDataPool

PreDataPool is a machine-to-machine data reuse layer for IoT devices, edge
workers, vehicles, and autonomous agents that keep asking for the same public
data.

The goal is simple: one canonical request, one upstream fetch/payment, one
encrypted cache entry, and verified reuse for later consumers.

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
│  1. API'ye istek at (normal yol)                    │
│  2. SDK hook: veriyi + zarfı pool'a gönder          │
└────────────────┬────────────────────────────────────┘
                 │ DataEnvelope (imzali)
                 ▼
┌─────────────────────────────────────────────────────┐
│              PreDataPool Node                       │
│  - RAM/Redis'te AoI-aware cache                    │
│  - canonical request key                           │
│  - encrypted payload at rest                       │
│  - expiry / signature verification                 │
│  - Merkle proof doğrulama                          │
│  - TTL: τ_decay (veri tipine göre)                 │
│  - Solana'da micro-settlement kaydı                │
└────────────────┬────────────────────────────────────┘
                 │ cache hit
                 ▼
┌─────────────────────────────────────────────────────┐
│                   AGENT B                           │
│  1. Pool'u sorgula (önce bak)                       │
│  2. Cache hit → doğrula → kullan → ödeme paylaş     │
│  3. Cache miss → direkt API çek → pool'a bildir     │
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

## Development Note

This repository is still being reduced from a broader prototype into a narrow
MVP for M2M, IoT, and edge reuse. Treat README claims as product intent, not
production readiness.
