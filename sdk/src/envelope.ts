/**
 * DataEnvelope v0 — the keeper-signed metadata bound to a cached payload.
 *
 * Wire-level format the server publishes (in `register_dataset` on-chain AND
 * the `X-DataPool-*` response headers) is a SHA-256 root over
 * `payload || source_url || fetched_at_ms || expires_at_ms` plus the
 * keeper's Ed25519 signature over that root. Buyers verify locally before
 * trusting the decrypted payload.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";

const U64_BYTES = 8;

export interface DataEnvelopeV0 {
  version: 0;
  sourceUrl: string;
  sourceHash: Uint8Array;
  fetchedAt: number;
  expiresAt: number;
  merkleRoot: Uint8Array;
  keeperPubkey: Uint8Array;
  keeperSignature: Uint8Array;
}

export interface KeeperKey {
  /** 32-byte Ed25519 seed (the first half of a Solana 64-byte secretKey). */
  secretKey: Uint8Array;
  /** 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
}

function u64be(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("timestamp must be a non-negative safe integer");
  }
  const out = new Uint8Array(U64_BYTES);
  let x = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function sha256Bytes(input: Uint8Array | string): Uint8Array {
  return sha256(typeof input === "string" ? new TextEncoder().encode(input) : input);
}

export function envelopeRoot(params: {
  payload: Uint8Array;
  sourceUrl: string;
  fetchedAt: number;
  expiresAt: number;
}): Uint8Array {
  return sha256Bytes(
    concatBytes([
      params.payload,
      new TextEncoder().encode(params.sourceUrl),
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
  keeper: KeeperKey;
}): DataEnvelopeV0 {
  if (params.keeper.secretKey.length !== 32) {
    throw new Error(
      `keeper.secretKey must be 32-byte seed (got ${params.keeper.secretKey.length})`
    );
  }
  if (params.keeper.publicKey.length !== 32) {
    throw new Error(
      `keeper.publicKey must be 32 bytes (got ${params.keeper.publicKey.length})`
    );
  }
  const merkleRoot = envelopeRoot(params);
  const keeperSignature = ed25519.sign(merkleRoot, params.keeper.secretKey);
  return {
    version: 0,
    sourceUrl: params.sourceUrl,
    sourceHash: sha256Bytes(params.sourceUrl),
    fetchedAt: params.fetchedAt,
    expiresAt: params.expiresAt,
    merkleRoot,
    keeperPubkey: params.keeper.publicKey,
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
  if (!bytesEqual(root, params.envelope.merkleRoot)) {
    return false;
  }
  return ed25519.verify(
    params.envelope.keeperSignature,
    params.envelope.merkleRoot,
    params.keeperPubkey
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
