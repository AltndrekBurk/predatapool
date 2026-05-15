#!/usr/bin/env node
/**
 * CLI runner for `claim_rebate` — pre-fetch sponsors call this to pull
 * their pro-rata share of post-fetch revenue from pool escrow.
 *
 *   SPONSOR_KEYPAIR_PATH=/path/to/keypair.json \
 *   SPONSOR_TOKEN_ACCOUNT=<sponsor_usdc_ata_pubkey> \
 *   PHOTON_RPC_URL=<photon_endpoint> \
 *   npm run -w datapool-server claim-rebate -- <pool_hash_hex>
 *
 * Requires PHOTON_RPC_URL — the leaf fetch + inclusion proof both go
 * through Photon. Exits 0 on success, 1 on any error.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { claimRebateOnChain } from "../keeper.js";

async function main(): Promise<void> {
  const requestHashHex = process.argv[2];
  if (!requestHashHex || requestHashHex.length !== 64) {
    throw new Error(
      "Usage: claim-rebate <pool_hash_hex (64 hex chars)>"
    );
  }
  if (!process.env.PHOTON_RPC_URL) {
    throw new Error(
      "PHOTON_RPC_URL env var required (Photon endpoint serves the BuyerSlot leaf)"
    );
  }

  const keypairPath =
    process.env.SPONSOR_KEYPAIR_PATH ?? `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
  const sponsorKeypair = Keypair.fromSecretKey(new Uint8Array(raw));

  const tokenAccountStr = process.env.SPONSOR_TOKEN_ACCOUNT;
  if (!tokenAccountStr) {
    throw new Error(
      "SPONSOR_TOKEN_ACCOUNT env var required (sponsor's USDC ATA pubkey)"
    );
  }
  const sponsorTokenAccount = new PublicKey(tokenAccountStr);

  console.log(
    `[claim-rebate] pool=${requestHashHex.slice(0, 16)}...  ` +
      `sponsor=${sponsorKeypair.publicKey.toBase58()}`
  );

  const sig = await claimRebateOnChain({
    requestHashHex,
    sponsorKeypair,
    sponsorTokenAccount,
  });

  console.log(`Tx: ${sig}`);
}

void main().catch((err) => {
  console.error("[claim-rebate] failed:", (err as Error).message);
  process.exit(1);
});
