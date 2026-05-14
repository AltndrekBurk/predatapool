/**
 * Server adapter over `@predatapool/sdk`'s envelope primitives.
 *
 * The SDK keeps the canonical wire-shape pure (no `@solana/web3.js` Keypair
 * coupling). Here we wrap it so server callers can pass a Solana Keypair and
 * get the same DataEnvelope back.
 */

import type { Keypair } from "@solana/web3.js";
import {
  buildDataEnvelopeV0 as buildDataEnvelopeV0Sdk,
  envelopeRoot as envelopeRootSdk,
  sha256Bytes as sha256BytesSdk,
  verifyDataEnvelopeV0,
} from "@predatapool/sdk";

/**
 * Server-shaped DataEnvelope — Buffer fields for back-compat with the
 * SQLite store + Anchor CPI callers. Wire-format is identical to the SDK.
 */
export interface DataEnvelopeV0 {
  version: 0;
  sourceUrl: string;
  sourceHash: Buffer;
  fetchedAt: number;
  expiresAt: number;
  merkleRoot: Buffer;
  keeperPubkey: Buffer;
  keeperSignature: Buffer;
}

export { verifyDataEnvelopeV0 };

export function sha256Bytes(input: Uint8Array | string): Buffer {
  return Buffer.from(sha256BytesSdk(input));
}

export function envelopeRoot(params: {
  payload: Uint8Array;
  sourceUrl: string;
  fetchedAt: number;
  expiresAt: number;
}): Buffer {
  return Buffer.from(envelopeRootSdk(params));
}

export function buildDataEnvelopeV0(params: {
  payload: Uint8Array;
  sourceUrl: string;
  fetchedAt: number;
  expiresAt: number;
  keeper: Keypair;
}): DataEnvelopeV0 {
  // Solana's Keypair stores a 64-byte secretKey (seed || pubkey); the SDK
  // only needs the 32-byte seed.
  const env = buildDataEnvelopeV0Sdk({
    payload: params.payload,
    sourceUrl: params.sourceUrl,
    fetchedAt: params.fetchedAt,
    expiresAt: params.expiresAt,
    keeper: {
      secretKey: params.keeper.secretKey.slice(0, 32),
      publicKey: params.keeper.publicKey.toBytes(),
    },
  });
  return {
    version: 0,
    sourceUrl: env.sourceUrl,
    sourceHash: Buffer.from(env.sourceHash),
    fetchedAt: env.fetchedAt,
    expiresAt: env.expiresAt,
    merkleRoot: Buffer.from(env.merkleRoot),
    keeperPubkey: Buffer.from(env.keeperPubkey),
    keeperSignature: Buffer.from(env.keeperSignature),
  };
}
