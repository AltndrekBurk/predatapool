# Hackathon Terminal Demo — Devnet

Scripted transcript for the live presentation.
All addresses are real devnet values.

---

## On-Chain Addresses

| Key | Value |
|-----|-------|
| Program ID | `62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D` |
| ProgramData | `FJXaxfb1SnkApPAJWZDEDKZGpo4BzDVHbhV5KPSunKMM` |
| Upgrade authority | `EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD` (keeper) |
| Deploy tx | `7cdYeYE5pG64GePt4qkTZ7F6uczAVtr8y2vbNeeZvaSzRmbR87GrCeJ6Ba7indQW47iWj9SjpmTpD4NgJz5cMcj` |
| Deployed slot | `461682633` |
| Devnet USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Agent 1 | `88FRN3hGUcv88DzrCKk4q85TSioL3Dv5ZjCJfyz8tsPC` |
| Agent 2 | `2WGYvoF6FUqgRnz8sr81qAxXdt4TajNSqPGTvJvV11GD` |
| Agent 3 | `EqaHDJ8eSaPAKstfn57peJy1BzsnC5Ji7LByLn5GbvcP` |
| Agent 4 | `C5347onFTjJFuUCbHuXbnPAfURL1kkXDiYZT2b1bu2fU` |
| Agent 5 | `8WaZgrR4RjGKoGWSgiTjiVWiCf93PUdVdBMGtobFaWQr` |
| Agent 6 | `3u51cSMpP1sRk7QYyAyQm2DJFSU25hoaWZc1qRnrGmWC` |
| Network | Solana Devnet |
| Public data | Open-Meteo (no API key) |

Explorer links:
```
Program  → https://explorer.solana.com/address/62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D?cluster=devnet
Deploy tx→ https://explorer.solana.com/tx/7cdYeYE5pG64GePt4qkTZ7F6uczAVtr8y2vbNeeZvaSzRmbR87GrCeJ6Ba7indQW47iWj9SjpmTpD4NgJz5cMcj?cluster=devnet
```

---

## Scene 1 — Start the stack

```text
$ cd /home/burak/datapool-protocol/server && npm run dev

[server] DataPool matching server ready on http://localhost:3001
[server] keeper=EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD
[server] program=62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D
[server] rpc=https://api.devnet.solana.com
```

```text
$ cd /home/burak/datapool-protocol && npm run dev

[app] ready on http://localhost:3000
[app] debug console ready on /debug
```

---

## Scene 2 — Run the devnet demo

```text
$ cd /home/burak/datapool-protocol/server
$ node ../hackathon-demo/devnet-demo.mjs

══════════════════════════════════════════════════════════════
  DataPool Protocol — Devnet Interactive Demo
══════════════════════════════════════════════════════════════
  Network  : Solana Devnet
  Program  : 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D
  Explorer : https://explorer.solana.com/address/62pKxmwZ...?cluster=devnet
  Keeper   : EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD
  Data API : Open-Meteo (Istanbul weather, public)
  Buyers   : 6 simulated M2M agents
──────────────────────────────────────────────────────────────
```

---

## Scene 3 — Pool creation + upstream fetch

```text
[phase 1] Pool creation — first 2 agents trigger upstream fetch
──────────────────────────────────────────────────────────────
  [1/6] agent-1  HTTP 200
  [1/6] agent-1    pool=3f2c9b6d1a...  cacheHit=false  fetchTriggered=false
  [1/6] agent-1    price=$0.100000  status=pending

  [2/6] agent-2  HTTP 200
  [2/6] agent-2    pool=3f2c9b6d1a...  cacheHit=false  fetchTriggered=true
  [2/6] agent-2    price=$0.100000  status=fetching

[keeper] waiting for fetch + on-chain dataset registration...
[keeper] done — status=fetched  buyers=2  dataHash=a1b2c3d4e5f60000...
```

---

## Scene 4 — On-chain PDA verification

```text
[chain] Pool PDA derived from request hash + program seeds
        Address : <pool-pda-address>
        Explorer: https://explorer.solana.com/address/<pool-pda>?cluster=devnet
        On-chain: lamports=2039280  data=312 bytes  ✓ registered
```

Point browser to the Pool PDA Explorer link — the account should exist on devnet.

Verify via CLI:

```bash
solana account <pool-pda-address> --url devnet
solana program show 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D --url devnet
```

---

## Scene 5 — Cache reuse (0 upstream calls)

```text
[phase 2] Cache reuse — agents 3-6 read from pool (0 upstream calls)
──────────────────────────────────────────────────────────────
  [3/6] agent-3  HTTP 200  cacheHit=true  price=$0.099000  ← cache hit
  [4/6] agent-4  HTTP 200  cacheHit=true  price=$0.098000  ← cache hit
  [5/6] agent-5  HTTP 200  cacheHit=true  price=$0.097000  ← cache hit
  [6/6] agent-6  HTTP 200  cacheHit=true  price=$0.096000  ← cache hit
```

---

## Scene 6 — Results & revenue distribution

```text
══════════════════════════════════════════════════════════════
  RESULTS
══════════════════════════════════════════════════════════════
  EFFICIENCY
──────────────────────────────────────────────────────────────
  Total agent requests  : 6
  Upstream API calls    : 1  (saved 5)
  Cache hits            : 4 / 6  (67%)
  Bandwidth saved       : 83% of upstream traffic eliminated

  REVENUE DISTRIBUTION
──────────────────────────────────────────────────────────────
  Total pool revenue    : $0.590000 USDC
  Data provider  (60%)  : $0.354000 USDC  ← ongoing, time-decayed
  Protocol share (40%)  : $0.236000 USDC  ← keeper + compute

  ON-CHAIN STATE
──────────────────────────────────────────────────────────────
  Program               : 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D
  Pool PDA              : <derived-pda>
  storage_uri           : http://localhost:3001/pool/<hash>/payload
  Keeper wallet         : EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD

  EXPLORER LINKS
──────────────────────────────────────────────────────────────
  Program  → https://explorer.solana.com/address/62pKxmwZ...?cluster=devnet
  Pool PDA → https://explorer.solana.com/address/<pda>?cluster=devnet
  Keeper   → https://explorer.solana.com/address/EMJ43KMv...?cluster=devnet
══════════════════════════════════════════════════════════════
```

---

## Demo talking points

- **6 M2M agents** ask for the same public API payload
- **1 upstream fetch** — DataPool batches them into a single request
- **4-5 cache hits** — subsequent agents pay less, provider keeps earning
- **On-chain PDA** — data hash + storage URI written to Solana devnet by keeper
- **Revenue split** — 60% to data provider, time-decayed so freshness = value
- **x402 payment loop** — each agent pays micro-USDC, no subscriptions, no API keys
