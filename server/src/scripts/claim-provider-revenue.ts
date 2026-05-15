#!/usr/bin/env node
/**
 * CLI runner for `claim_provider_revenue` — providers call this to pull
 * their marginal entitlement out of pool escrow on-chain.
 *
 *   PROVIDER_KEYPAIR_PATH=/path/to/keypair.json \
 *   PROVIDER_TOKEN_ACCOUNT=<provider_usdc_ata_pubkey> \
 *   npm run -w datapool-server claim-provider-revenue -- <pool_hash_hex>
 *
 * Exits 0 on success, 1 on any error. Prints the tx signature.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { claimProviderRevenueOnChain } from "../keeper.js";

async function main(): Promise<void> {
  const requestHashHex = process.argv[2];
  if (!requestHashHex || requestHashHex.length !== 64) {
    throw new Error(
      "Usage: claim-provider-revenue <pool_hash_hex (64 hex chars)>"
    );
  }

  const keypairPath =
    process.env.PROVIDER_KEYPAIR_PATH ?? `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
  const providerKeypair = Keypair.fromSecretKey(new Uint8Array(raw));

  const tokenAccountStr = process.env.PROVIDER_TOKEN_ACCOUNT;
  if (!tokenAccountStr) {
    throw new Error(
      "PROVIDER_TOKEN_ACCOUNT env var required (provider's USDC ATA pubkey)"
    );
  }
  const providerTokenAccount = new PublicKey(tokenAccountStr);

  console.log(
    `[claim-provider-revenue] pool=${requestHashHex.slice(0, 16)}...  ` +
      `provider=${providerKeypair.publicKey.toBase58()}`
  );

  const sig = await claimProviderRevenueOnChain({
    requestHashHex,
    providerKeypair,
    providerTokenAccount,
  });

  console.log(`Tx: ${sig}`);
}

void main().catch((err) => {
  console.error("[claim-provider-revenue] failed:", (err as Error).message);
  process.exit(1);
});
