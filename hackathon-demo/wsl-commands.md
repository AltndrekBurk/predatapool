# WSL Commands — Devnet Demo

All commands run from WSL. Program is deployed to Solana Devnet.

## On-Chain Addresses

```
Program ID  : 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D
ProgramData : FJXaxfb1SnkApPAJWZDEDKZGpo4BzDVHbhV5KPSunKMM
Keeper      : EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD
Devnet USDC : 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
Deploy slot : 461682633
Deploy tx   : 7cdYeYE5pG64GePt4qkTZ7F6uczAVtr8y2vbNeeZvaSzRmbR87GrCeJ6Ba7indQW47iWj9SjpmTpD4NgJz5cMcj
```

---

## 1. Install

```bash
npm install
cd server && npm install && cd ..
```

---

## 2. Get devnet SOL (needed for keeper txs)

Faucet (web): https://faucet.solana.com — paste `EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD`

Or CLI (rate-limited):

```bash
solana airdrop 2 --url devnet
solana balance --url devnet
```

---

## 3. Deploy the contract to devnet

**Already deployed** at slot `461682633`. To redeploy (e.g. after code changes):

```bash
solana program deploy \
  ~/datapool-protocol/anchor/target/deploy/datapool.so \
  --program-id ~/datapool-protocol/anchor/target/deploy/datapool-keypair.json \
  --url devnet \
  --keypair ~/.config/solana/id.json
```

Verify:

```bash
solana program show 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D --url devnet
```

---

## 4. Configure server

```bash
cp /home/burak/datapool-protocol/server/.env.example \
   /home/burak/datapool-protocol/server/.env
# .env is pre-filled — no edits needed for devnet demo
```

---

## 5. Start the stack (3 terminals)

**Terminal 1 — matching server:**

```bash
cd /home/burak/datapool-protocol/server
npm run dev
```

**Terminal 2 — frontend:**

```bash
cd /home/burak/datapool-protocol
npm run dev
```

**Terminal 3 — devnet demo script:**

```bash
cd /home/burak/datapool-protocol/server
node ../hackathon-demo/devnet-demo.mjs
```

---

## 6. Open the debug UI

```bash
explorer.exe "http://localhost:3000/debug"
```

---

## 7. On-chain verification (after demo runs)

```bash
# Check program is deployed
solana program show 62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D --url devnet

# Check keeper wallet balance
solana balance EMJ43KMv4A6icKLMFr2eKdEgV3AMfD3aF8XosXTBzzfD --url devnet

# Check pool PDA (address printed by devnet-demo.mjs)
solana account <pool-pda-from-demo-output> --url devnet
```

---

## 8. Run tests

```bash
cd /home/burak/datapool-protocol/server
npm test
```
