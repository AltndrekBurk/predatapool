/**
 * Buyer-side decryption primitives for PreDataPool payloads.
 *
 * Protocol:
 *   on-disk: AES-256-GCM(K_pool, plaintext, iv=random96)
 *   key delivery: ECIES x25519 — buyer signs an attestation, server wraps
 *                 K_pool to buyer's x25519 pubkey (80-byte blob)
 *   trust checks:
 *     1. SHA-256("DATAPOOL_K_V1" || K_pool) == on-chain key_commitment
 *     2. SHA-256(plaintext) == on-chain data_hash
 *     3. DataEnvelope v0 root + keeper signature match the headers
 *
 * Browser + Node compatible (WebCrypto + @noble). No `process.env` reads
 * and no transport implied — callers wire HTTP + signing themselves.
 */

import { gcm } from "@noble/ciphers/aes.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";

export const KEY_COMMITMENT_DOMAIN = new TextEncoder().encode("DATAPOOL_K_V1");
export const WRAP_HKDF_INFO = new TextEncoder().encode("DATAPOOL_WRAP_V1");
export const X25519_DERIVE_INFO = new TextEncoder().encode(
  "DATAPOOL_X25519_V1"
);
export const KEY_REQ_DOMAIN = new TextEncoder().encode("DATAPOOL_KEYREQ_V1");

/** Fixed message the buyer signs once per session to derive x25519 keypair. */
export const X25519_DERIVE_MESSAGE = new TextEncoder().encode(
  "DATAPOOL_X25519_DERIVE_V1:enc-key-derivation"
);

export const POOL_KEY_BYTES = 32;
export const PAYLOAD_IV_BYTES = 12;
export const X25519_KEY_BYTES = 32;
export const WRAPPED_KEY_BYTES = 80;

export type X25519Keypair = { secret: Uint8Array; pubkey: Uint8Array };

export type SignMessageFn = (
  msg: Uint8Array
) => Promise<{ signedMessage: Uint8Array; signature: Uint8Array }>;

/**
 * Derive a deterministic x25519 keypair from a wallet's Ed25519 signature
 * over a fixed domain message. Callers should cache the result per session
 * (a `WeakMap<walletRef, X25519Keypair>` is idiomatic in browsers).
 */
export async function deriveBuyerX25519(
  signMessage: SignMessageFn
): Promise<X25519Keypair> {
  const { signature } = await signMessage(X25519_DERIVE_MESSAGE);
  const secret = hkdf(
    sha256,
    signature,
    undefined,
    X25519_DERIVE_INFO,
    POOL_KEY_BYTES
  );
  const pubkey = x25519.getPublicKey(secret);
  return { secret, pubkey };
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("hex must have even length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u64be(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("Invalid envelope timestamp");
  }
  const out = new Uint8Array(8);
  let x = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/**
 * Canonical message a buyer signs to request K_pool delivery.
 * Mirrors `server/src/index.ts:keyReqMessage`.
 */
export function buildKeyReqMessage(
  poolHashHex: string,
  encPubHex: string,
  nonce: bigint
): Uint8Array {
  const domainLen = KEY_REQ_DOMAIN.length;
  const out = new Uint8Array(domainLen + 32 + 32 + 8);
  out.set(KEY_REQ_DOMAIN, 0);
  out.set(hexToBytes(poolHashHex), domainLen);
  out.set(hexToBytes(encPubHex), domainLen + 32);
  for (let i = 0; i < 8; i++) {
    out[domainLen + 64 + i] = Number((nonce >> BigInt((7 - i) * 8)) & 0xffn);
  }
  return out;
}

/**
 * ECIES unwrap: split (ephPub || ciphertext+tag), derive wrap key via HKDF
 * over the x25519 shared secret, AES-GCM-decrypt the K_pool with zero IV.
 */
export function unwrapPoolKey(
  wrapped: Uint8Array,
  recipientX25519Sec: Uint8Array
): Uint8Array {
  if (wrapped.length !== WRAPPED_KEY_BYTES) {
    throw new Error(
      `Unexpected wrapped key size: ${wrapped.length} (want ${WRAPPED_KEY_BYTES})`
    );
  }
  const ephPub = wrapped.slice(0, X25519_KEY_BYTES);
  const blob = wrapped.slice(X25519_KEY_BYTES);
  const shared = x25519.getSharedSecret(recipientX25519Sec, ephPub);
  const wrapKey = hkdf(sha256, shared, ephPub, WRAP_HKDF_INFO, POOL_KEY_BYTES);
  const zeroIv = new Uint8Array(PAYLOAD_IV_BYTES);
  return gcm(wrapKey, zeroIv).decrypt(blob);
}

/**
 * SHA-256("DATAPOOL_K_V1" || K_pool) — must equal on-chain `key_commitment`.
 * Pure function so the server can compute it the same way at registration.
 */
export function keyCommitment(poolKey: Uint8Array): Uint8Array {
  const buf = new Uint8Array(KEY_COMMITMENT_DOMAIN.length + POOL_KEY_BYTES);
  buf.set(KEY_COMMITMENT_DOMAIN, 0);
  buf.set(poolKey, KEY_COMMITMENT_DOMAIN.length);
  return sha256(buf);
}

export function checkKeyCommitment(
  poolKey: Uint8Array,
  commitment: Uint8Array
): boolean {
  return bytesEqual(keyCommitment(poolKey), commitment);
}

/** AES-256-GCM decrypt with a 12-byte IV (matching the server's encrypt path). */
export function decryptPayload(
  poolKey: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array {
  return gcm(poolKey, iv).decrypt(ciphertext);
}

/**
 * Recompute envelope root from plaintext + headers and compare to the
 * advertised root + keeper signature. Used by `fetchAndVerify`.
 */
export function verifyEnvelopeRootFromHeaders(
  plaintext: Uint8Array,
  fields: {
    sourceUrl: string;
    fetchedAt: number;
    expiresAt: number;
    merkleRootHex: string;
    keeperPubkeyHex: string;
    keeperSignatureHex: string;
  },
  now: number = Date.now()
): { ok: true } | { ok: false; reason: string } {
  if (fields.expiresAt <= now) {
    return { ok: false, reason: "DataEnvelope expired" };
  }
  const expectedRoot = hexToBytes(fields.merkleRootHex);
  const actualRoot = sha256(
    concatBytes([
      plaintext,
      new TextEncoder().encode(fields.sourceUrl),
      u64be(fields.fetchedAt),
      u64be(fields.expiresAt),
    ])
  );
  if (!bytesEqual(actualRoot, expectedRoot)) {
    return { ok: false, reason: "DataEnvelope root mismatch" };
  }
  const sig = hexToBytes(fields.keeperSignatureHex);
  const pub = hexToBytes(fields.keeperPubkeyHex);
  if (!ed25519.verify(sig, expectedRoot, pub)) {
    return { ok: false, reason: "Invalid keeper signature" };
  }
  return { ok: true };
}

/** SHA-256 in hex via WebCrypto (browser + Node 20+). */
export async function sha256Hex(input: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    input as unknown as ArrayBuffer
  );
  return bytesToHex(new Uint8Array(buf));
}
