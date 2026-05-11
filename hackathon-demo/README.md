# Hackathon Demo — Devnet

DataPool Protocol demo running against Solana Devnet.

## On-Chain Addresses

| | |
|---|---|
| Program | `62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D` |
| ProgramData | `FJXaxfb1SnkApPAJWZDEDKZGpo4BzDVHbhV5KPSunKMM` |
| Keeper wallet | `EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD` |
| Devnet USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Deploy tx | `7cdYeYE5pG64GePt4qkTZ7F6uczAVtr8y2vbNeeZvaSzRmbR87GrCeJ6Ba7indQW47iWj9SjpmTpD4NgJz5cMcj` |

## Demo Goal

Show that 6 M2M agents requesting the same public Open-Meteo weather payload
are deduplicated into one upstream fetch, then reused inside the freshness
window. On-chain: the Pool PDA is written to devnet by the keeper after fetch.
Revenue split: provider 60% (time-decayed) / protocol 40%.

## Files

| File | Purpose |
|------|---------|
| `devnet-demo.mjs` | **Main demo** — runs 6 agents, shows on-chain PDA + Explorer links, prints revenue distribution and efficiency metrics |
| `run-live-demo.mjs` | Minimal REST-only demo (no on-chain queries) |
| `wsl-commands.md` | Setup, deploy, and run commands |
| `terminal-demo.md` | Scripted transcript for live presentation |

## Quick Start

```bash
# 1. Get devnet SOL (web): https://faucet.solana.com
#    Paste: EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD

# 2. Deploy (if not already deployed)
cd /home/burak/datapool-protocol/anchor
anchor deploy --provider.cluster devnet

# 3. Start server
cd /home/burak/datapool-protocol/server
npm run dev

# 4. Run demo (in another terminal, from /server)
node ../hackathon-demo/devnet-demo.mjs
```
