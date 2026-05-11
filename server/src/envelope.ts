import { createHash } from "crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Keypair } from "@solana/web3.js";

const U64_BYTES = 8;

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

function u64be(n: number): Buffer {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("timestamp must be a non-negative safe integer");
  }
  const out = Buffer.alloc(U64_BYTES);
  out.writeBigUInt64BE(BigInt(n));
  return out;
}

export function sha256Bytes(input: Uint8Array | string): Buffer {
  return createHash("sha256").update(input).digest();
}

/**
 * DataEnvelope v0 root:
 * SHA256(payload || source_url || fetched_at_ms || expires_at_ms).
 */
export function envelopeRoot(params: {
  payload: Uint8Array;
  sourceUrl: string;
  fetchedAt: number;
  expiresAt: number;
}): Buffer {
  const source = Buffer.from(params.sourceUrl, "utf8");
  return sha256Bytes(
    Buffer.concat([
      Buffer.from(params.payload),
      source,
      u64be(params.fetchedAt),
      u64be(params.expiresAt),
    ])
  );
}

export function buildDataEnvelopeV0(params: {
  payload: Uint8Array;
  sourceUrl: string;
  fetchedAt: number;
  expiresAt: number;
  keeper: Keypair;
}): DataEnvelopeV0 {
  const merkleRoot = envelopeRoot(params);
  const secret = params.keeper.secretKey.slice(0, 32);
  const keeperSignature = Buffer.from(ed25519.sign(merkleRoot, secret));
  return {
    version: 0,
    sourceUrl: params.sourceUrl,
    sourceHash: sha256Bytes(params.sourceUrl),
    fetchedAt: params.fetchedAt,
    expiresAt: params.expiresAt,
    merkleRoot,
    keeperPubkey: Buffer.from(params.keeper.publicKey.toBytes()),
    keeperSignature,
  };
}

export function verifyDataEnvelopeV0(params: {
  payload: Uint8Array;
  envelope: DataEnvelopeV0;
  keeperPubkey: Uint8Array;
  now?: number;
}): boolean {
  if (params.envelope.expiresAt <= (params.now ?? Date.now())) {
    return false;
  }
  const root = envelopeRoot({
    payload: params.payload,
    sourceUrl: params.envelope.sourceUrl,
    fetchedAt: params.envelope.fetchedAt,
    expiresAt: params.envelope.expiresAt,
  });
  if (!root.equals(params.envelope.merkleRoot)) {
    return false;
  }
  return ed25519.verify(
    params.envelope.keeperSignature,
    params.envelope.merkleRoot,
    params.keeperPubkey
  );
}
