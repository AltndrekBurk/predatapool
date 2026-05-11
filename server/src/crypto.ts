/**
 * Hybrid encryption for cached pool payloads.
 *
 * Why: a cached payload sits on disk (SQLite). At-rest plaintext means a
 * disk leak / DB exfiltration breaks confidentiality even though the
 * keeper is the only party that ever needed plaintext (it had to fetch
 * upstream to begin with).
 *
 * Scheme (per pool):
 *
 *   K_pool := random 256-bit key
 *   C := AES-256-GCM(K_pool, payload, iv=random96)
 *   key_commitment := SHA-256("DATAPOOL_K_V1" || K_pool)   ← published on-chain
 *
 * Per buyer (key delivery):
 *
 *   buyer publishes x25519 pubkey (derived deterministically from a
 *   one-shot wallet signature on a constant domain string)
 *   wrapped := ECIES_x25519(buyer_x25519_pub, K_pool)
 *
 *   ECIES details:
 *     eph := fresh x25519 keypair
 *     shared := x25519(eph_priv, buyer_pub)
 *     wrap_key := HKDF-SHA256(shared, salt=eph_pub, info="DATAPOOL_WRAP_V1", L=32)
 *     iv := zero (each ECIES wrap has a fresh wrap_key, so nonce reuse is fine)
 *     blob := AES-256-GCM(wrap_key, K_pool, iv=0)
 *     wrapped := eph_pub (32) || blob (32 + 16 GCM tag) = 80 bytes
 *
 * Buyer decrypts:
 *   shared := x25519(buyer_priv, eph_pub)
 *   wrap_key := HKDF-SHA256(shared, salt=eph_pub, info=DOMAIN, L=32)
 *   K_pool := AES-256-GCM-decrypt(wrap_key, blob, iv=0)
 *   payload := AES-256-GCM-decrypt(K_pool, ciphertext, iv)
 *   assert SHA-256("DATAPOOL_K_V1" || K_pool) == on-chain key_commitment
 *   assert SHA-256(payload) == on-chain data_hash
 *
 * Trust boundary: keeper sees plaintext (it fetched upstream — unavoidable
 * without TEE). Everyone else needs (a) a valid wrapped key from the keeper
 * AND (b) the matching x25519 secret to decrypt. Disk leaker gets
 * ciphertext only.
 */

import { gcm } from "@noble/ciphers/aes.js";
import { x25519, edwardsToMontgomeryPub } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { randomBytes } from "node:crypto";

export const KEY_COMMITMENT_DOMAIN = new TextEncoder().encode("DATAPOOL_K_V1");
export const WRAP_HKDF_INFO = new TextEncoder().encode("DATAPOOL_WRAP_V1");

export const POOL_KEY_BYTES = 32;
export const PAYLOAD_IV_BYTES = 12;
export const X25519_KEY_BYTES = 32;
/** 32 byte ephemeral pubkey + (32 byte K_pool + 16 byte GCM tag) = 80 bytes. */
export const WRAPPED_KEY_BYTES = 80;
export const KEY_COMMITMENT_BYTES = 32;

export interface EncryptedPayload {
  ciphertext: Uint8Array; // includes appended GCM tag (last 16 bytes)
  iv: Uint8Array; // 12 bytes
}

/** Generate a fresh per-pool symmetric key. */
export function newPoolKey(): Uint8Array {
  return new Uint8Array(randomBytes(POOL_KEY_BYTES));
}

/**
 * On-chain commitment to the per-pool key. Published in `register_dataset`.
 * Buyers verify their unwrapped K_pool against this so a malicious keeper
 * can't deliver different K_pool values to different buyers.
 */
export function keyCommitment(poolKey: Uint8Array): Uint8Array {
  const buf = new Uint8Array(KEY_COMMITMENT_DOMAIN.length + poolKey.length);
  buf.set(KEY_COMMITMENT_DOMAIN, 0);
  buf.set(poolKey, KEY_COMMITMENT_DOMAIN.length);
  return sha256(buf);
}

export function encryptPayload(
  poolKey: Uint8Array,
  plaintext: Uint8Array
): EncryptedPayload {
  if (poolKey.length !== POOL_KEY_BYTES) {
    throw new Error(`poolKey must be ${POOL_KEY_BYTES} bytes`);
  }
  const iv = new Uint8Array(randomBytes(PAYLOAD_IV_BYTES));
  const ciphertext = gcm(poolKey, iv).encrypt(plaintext);
  return { ciphertext, iv };
}

export function decryptPayload(
  poolKey: Uint8Array,
  enc: EncryptedPayload
): Uint8Array {
  return gcm(poolKey, enc.iv).decrypt(enc.ciphertext);
}

/**
 * Wrap K_pool for delivery to a buyer using their x25519 pubkey (ECIES).
 * Returns a fixed-size 80-byte blob: eph_pub (32) || aes_gcm_blob (48).
 */
export function wrapPoolKey(
  poolKey: Uint8Array,
  recipientX25519Pub: Uint8Array
): Uint8Array {
  if (poolKey.length !== POOL_KEY_BYTES) {
    throw new Error("poolKey wrong size");
  }
  if (recipientX25519Pub.length !== X25519_KEY_BYTES) {
    throw new Error("recipient x25519 pubkey wrong size");
  }
  const ephSecret = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSecret);
  const shared = x25519.getSharedSecret(ephSecret, recipientX25519Pub);
  const wrapKey = hkdf(sha256, shared, ephPub, WRAP_HKDF_INFO, 32);
  // iv = 12 zero bytes — each wrap has a fresh wrap_key (because of fresh eph),
  // so nonce-reuse semantics don't apply. Standard ECIES pattern.
  const zeroIv = new Uint8Array(PAYLOAD_IV_BYTES);
  const blob = gcm(wrapKey, zeroIv).encrypt(poolKey);
  // Concatenate: eph_pub || blob
  const wrapped = new Uint8Array(WRAPPED_KEY_BYTES);
  wrapped.set(ephPub, 0);
  wrapped.set(blob, X25519_KEY_BYTES);
  return wrapped;
}

/** Inverse of wrapPoolKey for the buyer side (also exported for tests). */
export function unwrapPoolKey(
  wrapped: Uint8Array,
  recipientX25519Sec: Uint8Array
): Uint8Array {
  if (wrapped.length !== WRAPPED_KEY_BYTES) {
    throw new Error(`wrapped must be ${WRAPPED_KEY_BYTES} bytes`);
  }
  const ephPub = wrapped.slice(0, X25519_KEY_BYTES);
  const blob = wrapped.slice(X25519_KEY_BYTES);
  const shared = x25519.getSharedSecret(recipientX25519Sec, ephPub);
  const wrapKey = hkdf(sha256, shared, ephPub, WRAP_HKDF_INFO, 32);
  const zeroIv = new Uint8Array(PAYLOAD_IV_BYTES);
  return gcm(wrapKey, zeroIv).decrypt(blob);
}

/**
 * Convert a Solana ed25519 wallet pubkey to an x25519 (Curve25519) pubkey.
 * Standard Edwards→Montgomery point map (RFC 7748). Lets us treat any
 * Solana wallet as an ECIES recipient WITHOUT requiring the wallet's
 * private key (which is used only for signing, never for ECDH on Solana).
 *
 * Note: this maps the ed25519 PUBLIC key. The matching x25519 SECRET key
 * cannot be derived from the wallet's ed25519 SECRET key without exposing
 * it — wallets refuse. So buyers derive a SEPARATE x25519 keypair from a
 * deterministic wallet signature (see app/lib/crypto.ts).
 */
export function ed25519PubToX25519Pub(edPub: Uint8Array): Uint8Array {
  if (edPub.length !== 32) throw new Error("ed25519 pubkey must be 32 bytes");
  return edwardsToMontgomeryPub(edPub);
}
