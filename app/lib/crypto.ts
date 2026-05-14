/**
 * Buyer-side decryption flow — app-specific glue around the SDK's
 * cryptographic primitives.
 *
 * What the app adds on top of `@predatapool/sdk`:
 *   - WeakMap cache keyed by walletRef so the user signs the x25519-derive
 *     message at most once per session (the SDK's `deriveBuyerX25519` is
 *     stateless on purpose — caching is a UI concern).
 *   - Server URL captured from `NEXT_PUBLIC_SERVER_URL`.
 *   - HTTP wiring for `POST /pool/:hash/key` + `GET /pool/:hash/payload`.
 */

import {
  buildKeyReqMessage,
  bytesToHex,
  checkKeyCommitment,
  decryptPayload,
  deriveBuyerX25519,
  hexToBytes,
  sha256Hex,
  unwrapPoolKey,
  verifyEnvelopeRootFromHeaders,
  WRAPPED_KEY_BYTES,
  type SignMessageFn,
  type X25519Keypair,
} from "@predatapool/sdk";
import {
  DataEnvelopeVerificationError,
  DecryptDataHashMismatchError,
  KeyCommitmentError,
} from "@predatapool/sdk";

export { DataEnvelopeVerificationError, DecryptDataHashMismatchError, KeyCommitmentError };

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

// Per-session x25519 cache — wallet signs the derive-message once, cached
// against the wallet context object (stable across React re-renders).
const sessionKeyCache = new WeakMap<object, X25519Keypair>();

export async function cachedDeriveBuyerX25519(
  signMessage: SignMessageFn,
  walletRef: object
): Promise<X25519Keypair> {
  const cached = sessionKeyCache.get(walletRef);
  if (cached) return cached;
  const kp = await deriveBuyerX25519(signMessage);
  sessionKeyCache.set(walletRef, kp);
  return kp;
}

export interface DecryptResult {
  plaintext: Uint8Array;
  data: unknown;
  verified: true;
}

/**
 * Full buyer-side decrypt flow against the pool node:
 *   1. Derive x25519 keypair (cached per wallet session)
 *   2. POST /pool/:hash/key — signed attestation → wrapped K_pool
 *   3. GET /pool/:hash/payload — encrypted bytes + envelope headers
 *   4. Unwrap K_pool + verify key_commitment
 *   5. AES-256-GCM decrypt
 *   6. Verify DataEnvelope root + keeper sig
 *   7. SHA-256(plaintext) == data_hash
 */
export async function fetchDecryptAndVerify(params: {
  poolHashHex: string;
  buyerPubkey: string;
  dataHash: string;
  signMessage: SignMessageFn;
  walletRef: object;
}): Promise<DecryptResult> {
  const { poolHashHex, buyerPubkey, dataHash, signMessage, walletRef } = params;

  // Step 1
  const { secret: buyerSecret, pubkey: buyerPub } =
    await cachedDeriveBuyerX25519(signMessage, walletRef);
  const encPubHex = bytesToHex(buyerPub);

  // Step 2 — signed key request
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
    const err = (await keyRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Key delivery failed: ${keyRes.status}`);
  }
  const keyData = (await keyRes.json()) as {
    wrappedKey: string;
    keyCommitment: string;
  };

  // Step 3 — encrypted payload
  const payloadRes = await fetch(`${SERVER_URL}/pool/${poolHashHex}/payload`);
  if (!payloadRes.ok) throw new Error(`Payload fetch failed: ${payloadRes.status}`);
  const ciphertext = new Uint8Array(await payloadRes.arrayBuffer());
  const ivHex = payloadRes.headers.get("X-DataPool-IV");
  if (!ivHex) throw new Error("Missing X-DataPool-IV header");
  const iv = hexToBytes(ivHex);

  // Step 4 — unwrap + commit check
  const wrapped = hexToBytes(keyData.wrappedKey);
  if (wrapped.length !== WRAPPED_KEY_BYTES) {
    throw new Error(`Unexpected wrapped key size: ${wrapped.length}`);
  }
  const poolKey = unwrapPoolKey(wrapped, buyerSecret);
  if (!checkKeyCommitment(poolKey, hexToBytes(keyData.keyCommitment))) {
    throw new KeyCommitmentError();
  }

  // Step 5 — decrypt
  const plaintext = decryptPayload(poolKey, iv, ciphertext);

  // Step 6 — envelope
  const sourceUrl = payloadRes.headers.get("X-DataPool-Source-Url");
  const fetchedAtRaw = payloadRes.headers.get("X-DataPool-Fetched-At");
  const expiresAtRaw = payloadRes.headers.get("X-DataPool-Expires-At");
  const merkleRootHex = payloadRes.headers.get("X-DataPool-Merkle-Root");
  const keeperPubkeyHex = payloadRes.headers.get("X-DataPool-Keeper-Pubkey");
  const keeperSignatureHex = payloadRes.headers.get(
    "X-DataPool-Keeper-Signature"
  );
  if (
    !sourceUrl ||
    !fetchedAtRaw ||
    !expiresAtRaw ||
    !merkleRootHex ||
    !keeperPubkeyHex ||
    !keeperSignatureHex
  ) {
    throw new DataEnvelopeVerificationError("Missing DataEnvelope headers");
  }
  const envCheck = verifyEnvelopeRootFromHeaders(plaintext, {
    sourceUrl,
    fetchedAt: Number(fetchedAtRaw),
    expiresAt: Number(expiresAtRaw),
    merkleRootHex,
    keeperPubkeyHex,
    keeperSignatureHex,
  });
  if (!envCheck.ok) throw new DataEnvelopeVerificationError(envCheck.reason);

  // Step 7 — data_hash
  const actualHash = await sha256Hex(plaintext);
  if (actualHash !== dataHash) {
    throw new DecryptDataHashMismatchError(dataHash, actualHash);
  }

  const contentType = payloadRes.headers.get("X-DataPool-Plaintext-Type") ?? "";
  let data: unknown = plaintext;
  if (contentType.includes("application/json")) {
    data = JSON.parse(new TextDecoder().decode(plaintext));
  }
  return { plaintext, data, verified: true };
}
