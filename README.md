# PreDataPool

PreDataPool is an MVP protocol for public API data sharing between agents:
one canonical request, one upstream fetch/payment, encrypted cache reuse, and
buyer-side verification.

## Current Scope

The first target is deliberately narrow:

- public, shareable API data
- x402/mock upstream payment flow
- canonical request deduplication
- AoI/freshness-window cache reuse
- AES-GCM encrypted payload storage
- buyer-side decrypt and SHA-256 verification
- Solana devnet settlement primitives

Out of scope for the first MVP:

- private/user-specific data
- real-time trading-critical feeds
- full provider marketplace
- mainnet production claims
- mandatory Light Protocol compression for every path

## Why

Agents that ask for the same paid API payload should not force the provider to
compute and serve the same response repeatedly. The useful saving is not only
Solana transaction cost; it is provider compute, rate-limit pressure, bandwidth,
and duplicated x402 payment loops.

## Basic Flow

```
1. Agent submits a request.
2. PreDataPool derives the canonical request key.
3. Cache miss:
   - fetch once from upstream through x402/API/free mode
   - hash raw bytes
   - encrypt payload at rest
   - build DataEnvelope metadata
   - register verifiable metadata on Solana
4. Cache hit:
   - verify expiry and envelope/hash metadata
   - authorize buyer before key delivery
   - return wrapped key + encrypted payload
   - buyer decrypts and verifies locally
5. Reuse settlement records provider/fetcher/protocol economics.
```

Future SDK relay must be non-blocking: the agent's fetch response must not wait
for pool relay completion.

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
anchor/   Solana Anchor programs
server/   matching server, fetcher, cache, keeper glue
app/      Next.js frontend
docs/     local external protocol references
```

## Development Note

This repository is still being reduced from a broader prototype into the narrow
public-data MVP. Treat README claims as product intent, not production readiness.
