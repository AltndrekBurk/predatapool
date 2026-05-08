/**
 * x402 smoke runner — exercises the full keeper → MPP fetch → payment → 200 loop
 * against a running mock-upstream. Manual; needs a Solana RPC and a keeper
 * keypair with USDC.
 *
 * Run:
 *   1) Terminal A:  MOCK_RECIPIENT_PUBKEY=<recipient> npm run mock-upstream
 *   2) Terminal B:  npm run smoke-x402
 *
 * Env:
 *   MOCK_UPSTREAM_URL  default http://localhost:4001/paid-data
 *   SOLANA_RPC_URL     default https://api.devnet.solana.com (from keeper.ts)
 *   KEEPER_KEYPAIR_PATH default ~/.config/solana/id.json
 */

import { fetchData } from "./fetcher.js";
import { loadKeeperKitSigner, getKeeperRpcUrl } from "./keeper.js";

const URL_TO_FETCH =
  process.env.MOCK_UPSTREAM_URL ?? "http://localhost:4001/paid-data";

async function main() {
  console.log(`[smoke] target: ${URL_TO_FETCH}`);
  console.log(`[smoke] rpc:    ${getKeeperRpcUrl()}`);
  const signer = await loadKeeperKitSigner();
  console.log(`[smoke] signer: ${signer.address}`);
  console.log(`[smoke] starting fetch — expect 402 → sign → retry → 200\n`);

  const start = Date.now();
  const result = await fetchData(
    URL_TO_FETCH,
    { lat: "40.0", lon: "29.0" },
    {
      upstream: { kind: "mpp", currency: "USDC" },
      mppSigner: signer,
      rpcUrl: getKeeperRpcUrl(),
    }
  );
  const elapsedMs = Date.now() - start;

  console.log("\n[smoke] OK");
  console.log(`  duration:           ${elapsedMs}ms`);
  console.log(`  data:               ${JSON.stringify(result.data)}`);
  console.log(`  data_hash (sha256): ${result.dataHash.toString("hex")}`);
  if (result.paymentSignature) {
    console.log(`  payment signature:  ${result.paymentSignature}`);
  } else {
    console.log(
      "  payment signature:  (none captured — check mppx onProgress wiring)"
    );
  }
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
