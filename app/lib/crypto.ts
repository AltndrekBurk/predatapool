/**
 * Buyer-side decryption for encrypted DataPool payloads.
 *
 * Protocol (mirror of server/src/crypto.ts):
 *   on-disk: AES-256-GCM(K_pool, plaintext, iv=random96)
 *   key delivery: ECIES x25519 — buyer proves membership via ed25519 sig,
 *                 server wraps K_pool to buyer's x25519 pubkey (80-byte blob)
 *   trust checks:
 *     1. SHA-256("DATAPOOL_K_V1" || K_pool) == on-chain key_commitment
 *     2. SHA-256(plaintext) == on-chain data_hash
 *
 * Key derivation:
 *   Buyer's x25519 keypair is derived deterministically from a wallet
 *   signature on a fixed domain string. Same wallet → same keypair every
 *   session. User is prompted once per session (cached in module scope).
 */

import { gcm } from "@noble/ciphers/aes.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";

const KEY_COMMITMENT_DOMAIN = new TextEncoder().encode("DATAPOOL_K_V1");
const WRAP_HKDF_INFO = new TextEncoder().encode("DATAPOOL_WRAP_V1");
const X25519_DERIVE_INFO = new TextEncoder().encode("DATAPOOL_X25519_V1");
const KEY_REQ_DOMAIN = new TextEncoder().encode("DATAPOOL_KEYREQ_V1");

/** Fixed message the buyer signs once per session to derive x25519 keypair. */
const X25519_DERIVE_MESSAGE = new TextEncoder().encode(
  "DATAPOOL_X25519_DERIVE_V1:enc-key-derivation"
);

const POOL_KEY_BYTES = 32;
const PAYLOAD_IV_BYTES = 12;
const X25519_KEY_BYTES = 32;
const WRAPPED_KEY_BYTES = 80;

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

// ── Per-session key derivation cache ───────────────────────────────────────
// Avoids re-prompting the wallet on every decrypt call within the same session.

type X25519Keypair = { secret: Uint8Array; pubkey: Uint8Array };
const sessionKeyCache = new WeakMap<object, X25519Keypair>();

type SignMessageFn = (
  msg: Uint8Array
) => Promise<{ signedMessage: Uint8Array; signature: Uint8Array }>;

/**
 * Derive buyer's x25519 keypair from a deterministic wallet signature.
 * Prompts the wallet once per session; subsequent calls hit the cache.
 *
 * `walletRef` must be a stable object reference (e.g. the wallet context
 * value) so the WeakMap cache key survives across re-renders without leaking.
 */
export async function deriveBuyerX25519(
  signMessage: SignMessageFn,
  walletRef: object
): Promise<X25519Keypair> {
  const cached = sessionKeyCache.get(walletRef);
  if (cached) return cached;

  const { signature } = await signMessage(X25519_DERIVE_MESSAGE);
  const secret = hkdf(sha256, signature, undefined, X25519_DERIVE_INFO, POOL_KEY_BYTES);
  const pubkey = x25519.getPublicKey(secret);
  const kp: X25519Keypair = { secret, pubkey };
  sessionKeyCache.set(walletRef, kp);
  return kp;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
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
    throw new DataEnvelopeVerificationError("Invalid envelope timestamp");
  }
  const out = new Uint8Array(8);
  let x = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** Canonical key-request message — mirrors server-side keyReqMessage. */
function buildKeyReqMessage(
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

function unwrapPoolKey(
  wrapped: Uint8Array,
  recipientX25519Sec: Uint8Array
): Uint8Array {
  const ephPub = wrapped.slice(0, X25519_KEY_BYTES);
  const blob = wrapped.slice(X25519_KEY_BYTES);
  const shared = x25519.getSharedSecret(recipientX25519Sec, ephPub);
  const wrapKey = hkdf(sha256, shared, ephPub, WRAP_HKDF_INFO, POOL_KEY_BYTES);
  const zeroIv = new Uint8Array(PAYLOAD_IV_BYTES);
  return gcm(wrapKey, zeroIv).decrypt(blob);
}

function checkKeyCommitment(
  poolKey: Uint8Array,
  commitment: Uint8Array
): boolean {
  const buf = new Uint8Array(KEY_COMMITMENT_DOMAIN.length + POOL_KEY_BYTES);
  buf.set(KEY_COMMITMENT_DOMAIN, 0);
  buf.set(poolKey, KEY_COMMITMENT_DOMAIN.length);
  const actual = sha256(buf);
  if (actual.length !== commitment.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== commitment[i]) return false;
  }
  return true;
}

// ── Error classes ──────────────────────────────────────────────────────────

export class KeyCommitmentError extends Error {
  constructor() {
    super("Key commitment mismatch — keeper delivered wrong K_pool");
    this.name = "KeyCommitmentError";
  }
}

export class DecryptDataHashMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`Data hash mismatch after decrypt: expected ${expected}, got ${actual}`);
    this.name = "DecryptDataHashMismatchError";
  }
}

export class DataEnvelopeVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataEnvelopeVerificationError";
  }
}

function verifyEnvelopeHeaders(plaintext: Uint8Array, headers: Headers): void {
  const sourceUrl = headers.get("X-DataPool-Source-Url");
  const fetchedAtRaw = headers.get("X-DataPool-Fetched-At");
  const expiresAtRaw = headers.get("X-DataPool-Expires-At");
  const rootHex = headers.get("X-DataPool-Merkle-Root");
  const keeperPubkeyHex = headers.get("X-DataPool-Keeper-Pubkey");
  const keeperSigHex = headers.get("X-DataPool-Keeper-Signature");
  if (!sourceUrl || !fetchedAtRaw || !expiresAtRaw || !rootHex || !keeperPubkeyHex || !keeperSigHex) {
    throw new DataEnvelopeVerificationError("Missing DataEnvelope headers");
  }

  const fetchedAt = Number(fetchedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  if (expiresAt <= Date.now()) {
    throw new DataEnvelopeVerificationError("DataEnvelope expired");
  }

  const expectedRoot = hexToBytes(rootHex);
  const actualRoot = sha256(
    concatBytes([
      plaintext,
      new TextEncoder().encode(sourceUrl),
      u64be(fetchedAt),
      u64be(expiresAt),
    ])
  );
  if (!bytesEqual(actualRoot, expectedRoot)) {
    throw new DataEnvelopeVerificationError("DataEnvelope root mismatch");
  }
  if (!ed25519.verify(hexToBytes(keeperSigHex), expectedRoot, hexToBytes(keeperPubkeyHex))) {
    throw new DataEnvelopeVerificationError("Invalid keeper signature");
  }
}

// ── Main API ───────────────────────────────────────────────────────────────

export interface DecryptResult {
  plaintext: Uint8Array;
  data: unknown;
  verified: true;
}

/**
 * Full buyer-side decrypt flow for a fetched DataPool:
 *
 *  1. Derive x25519 keypair (one wallet sig per session, cached)
 *  2. POST /pool/:hash/key — signed attestation → wrapped K_pool
 *  3. GET /pool/:hash/payload — encrypted bytes + IV header
 *  4. Unwrap K_pool + verify key_commitment
 *  5. AES-256-GCM decrypt
 *  6. SHA-256(plaintext) == data_hash
 *
 * Throws `KeyCommitmentError` or `DecryptDataHashMismatchError` on trust
 * failures; throws `Error` on network/crypto errors.
 */
export async function fetchDecryptAndVerify(params: {
  poolHashHex: string;
  buyerPubkey: string;
  dataHash: string;
  signMessage: SignMessageFn;
  walletRef: object;
}): Promise<DecryptResult> {
  const { poolHashHex, buyerPubkey, dataHash, signMessage, walletRef } = params;

  // Step 1 — derive buyer x25519 keypair (cached after first call)
  const { secret: buyerSecret, pubkey: buyerPub } = await deriveBuyerX25519(
    signMessage,
    walletRef
  );
  const encPubHex = bytesToHex(buyerPub);

  // Step 2 — sign key-request attestation and send to server
  const nonce = BigInt(Date.now());
  const reqMsg = buildKeyReqMessage(poolHashHex, encPubHex, nonce);
  const { signature } = await signMessage(reqMsg);

  const keyRes = await fetch(`${SERVER_URL}/pool/${poolHashHex}/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      buyer: buyerPubkey,
      encPubkey: encPubHex,
      nonce: nonce.toString(),
      signature: bytesToHex(signature),
    }),
  });
  if (!keyRes.ok) {
    const err = (await keyRes.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      err.error ?? `Key delivery failed: ${keyRes.status}`
    );
  }
  const keyData = (await keyRes.json()) as {
    wrappedKey: string;
    keyCommitment: string;
  };

  // Step 3 — fetch encrypted payload
  const payloadRes = await fetch(`${SERVER_URL}/pool/${poolHashHex}/payload`);
  if (!payloadRes.ok) {
    throw new Error(`Payload fetch failed: ${payloadRes.status}`);
  }
  const ciphertext = new Uint8Array(await payloadRes.arrayBuffer());
  const ivHex = payloadRes.headers.get("X-DataPool-IV");
  if (!ivHex) throw new Error("Missing X-DataPool-IV header");
  const iv = hexToBytes(ivHex);

  // Step 4 — unwrap K_pool and verify key_commitment
  const wrapped = hexToBytes(keyData.wrappedKey);
  if (wrapped.length !== WRAPPED_KEY_BYTES) {
    throw new Error(`Unexpected wrapped key size: ${wrapped.length}`);
  }
  const poolKey = unwrapPoolKey(wrapped, buyerSecret);

  const commitment = hexToBytes(keyData.keyCommitment);
  if (!checkKeyCommitment(poolKey, commitment)) {
    throw new KeyCommitmentError();
  }

  // Step 5 — decrypt
  const plaintext = gcm(poolKey, iv).decrypt(ciphertext);

  // Step 6 — verify DataEnvelope + data_hash against plaintext
  verifyEnvelopeHeaders(plaintext, payloadRes.headers);

  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    plaintext as unknown as ArrayBuffer
  );
  const actualHash = bytesToHex(new Uint8Array(hashBuf));
  if (actualHash !== dataHash) {
    throw new DecryptDataHashMismatchError(dataHash, actualHash);
  }

  const contentType =
    payloadRes.headers.get("X-DataPool-Plaintext-Type") ?? "";
  let data: unknown = plaintext;
  if (contentType.includes("application/json")) {
    data = JSON.parse(new TextDecoder().decode(plaintext));
  }

  return { plaintext, data, verified: true };
}
