/**
 * Mock MPP-charging upstream — runnable demo target for the keeper's
 * x402 payment loop.
 *
 * Speaks the same MPP / x402 protocol as a real paid API: every request to
 * `/paid-data` returns 402 with a USDC charge challenge until the caller
 * presents a signed Solana payment proof. After payment is verified,
 * returns a deterministic mock JSON payload.
 *
 * Run:
 *   MOCK_RECIPIENT_PUBKEY=<your_wallet> npm run mock-upstream
 *
 * Then point the main server at `http://localhost:4001/paid-data` — the
 * provider registry already has a matching agreement with `kind: "mpp"`.
 */

import * as http from "node:http";
import { Mppx, solana } from "@solana/mpp/server";

const PORT = Number(process.env.MOCK_UPSTREAM_PORT ?? 4001);
const NETWORK =
  (process.env.MOCK_UPSTREAM_NETWORK as
    | "devnet"
    | "localnet"
    | "mainnet-beta"
    | undefined) ?? "devnet";
const RPC_URL = process.env.MOCK_UPSTREAM_RPC_URL; // optional override
const RECIPIENT = process.env.MOCK_RECIPIENT_PUBKEY;
const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_MINT = process.env.MOCK_UPSTREAM_USDC_MINT ?? USDC_MINT_DEVNET;

if (!RECIPIENT) {
  console.error(
    "[mock-upstream] MOCK_RECIPIENT_PUBKEY required — payments must go somewhere."
  );
  process.exit(1);
}

// SECRET_KEY binds challenges to their contents so the server can verify that
// an incoming credential matches a challenge it issued. Dev default OK; in
// production this MUST come from env and be unique per deployment.
const SECRET_KEY = process.env.MOCK_PAYMENT_SECRET ?? "datapool-mock-dev-only";

const mppx = Mppx.create({
  methods: [
    solana.charge({
      recipient: RECIPIENT,
      currency: USDC_MINT, // base58 mint = SPL token charge
      decimals: 6,
      network: NETWORK,
      ...(RPC_URL ? { rpcUrl: RPC_URL } : {}),
    }),
  ],
  secretKey: SECRET_KEY,
});

/**
 * Per-request price in USDC micro-units. Buyers in DataPool pool together
 * so the *upstream* sees a single payment of this amount per fetch — that's
 * the saving x402-MPP delivers over per-buyer-per-fetch billing.
 */
const PRICE_USDC_MICROS = process.env.MOCK_PRICE_MICROS ?? "50000"; // $0.05

http
  .createServer(async (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" }).end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, network: NETWORK }));
      return;
    }

    if (url.pathname !== "/paid-data") {
      res.writeHead(404).end();
      return;
    }

    // Run the MPP charge handler. On 402 it writes the challenge and ends
    // the response; on success it sets the Payment-Receipt header and
    // returns control so we can write the actual payload.
    const result = await Mppx.toNodeListener(
      mppx.charge({
        amount: PRICE_USDC_MICROS,
        currency: USDC_MINT,
      })
    )(req, res);

    if (result.status === 402) return;

    // Deterministic mock payload — the same request always yields the same
    // body so on-chain `data_hash` checks are reproducible across runs.
    const lat = url.searchParams.get("lat") ?? "0";
    const lon = url.searchParams.get("lon") ?? "0";
    const body = {
      lat,
      lon,
      tempC: 21.5,
      humidity: 0.62,
      source: "datapool-mock-upstream",
      issuedAt: "2026-05-08T00:00:00Z",
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  })
  .listen(PORT, () => {
    console.log(`[mock-upstream] MPP charging server on :${PORT}`);
    console.log(`  network:    ${NETWORK}`);
    console.log(`  recipient:  ${RECIPIENT}`);
    console.log(`  currency:   ${USDC_MINT} (USDC, 6 decimals)`);
    console.log(`  price:      ${PRICE_USDC_MICROS} micro-USDC per request`);
    console.log(`  endpoint:   GET http://localhost:${PORT}/paid-data?lat=&lon=`);
  });
