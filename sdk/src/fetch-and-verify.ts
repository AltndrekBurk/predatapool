/**
 * Read-side orchestration — the full M2M consumer flow:
 *
 *   1. POST /request          → pool hash + status
 *   2. Poll /pool/:hash/metadata until status === "fetched" (or timeout)
 *   3. Sign receipt + POST    (settles on-chain via the keeper's drain)
 *   4. Derive x25519 keypair  (one wallet sig per session)
 *   5. POST /pool/:hash/key   → wrapped K_pool
 *   6. GET /pool/:hash/payload → ciphertext + envelope headers
 *   7. Unwrap K_pool, verify key_commitment, decrypt
 *   8. Verify envelope root + keeper sig + data_hash
 *
 * The whole flow is wrapped in `Singleflight` keyed by the canonical pool
 * hash — N concurrent callers for the same request share one fetch.
 */

import type { PoolClient, ReceiptWire } from "./client.js";
import { Singleflight } from "./coalesce.js";
import {
  bytesToHex,
  buildKeyReqMessage,
  checkKeyCommitment,
  decryptPayload,
  deriveBuyerX25519,
  hexToBytes,
  sha256Hex,
  unwrapPoolKey,
  verifyEnvelopeRootFromHeaders,
  type SignMessageFn,
} from "./crypto.js";
import {
  DataEnvelopeVerificationError,
  DataPoolHashMismatchError,
  DecryptDataHashMismatchError,
  KeyCommitmentError,
} from "./errors.js";
import { hashRequestV2Hex } from "./request-key.js";
import { serializeReceipt, hexFromBytes, type JoinReceipt } from "./receipt.js";
import type { DataType, PoolMetadata } from "./types.js";
import type { Address } from "@solana/kit";

export interface FetchAndVerifyInput {
  /** Canonical request inputs (same shape used by the pool node's matcher). */
  endpoint: string;
  params?: Record<string, string>;
  method?: string;
  providerId: string;
  freshnessWindowSecs: number;
  dataType?: DataType;
  buyer: Address;
  /** Buyer-declared spending ceiling in USDC micro-units (for the receipt). */
  maxPrice: bigint;
  /** Unix-seconds-from-now until the receipt becomes invalid. Default 600. */
  receiptDeadlineFromNowSecs?: number;
  /** Wallet signing function — produces ed25519 sigs for receipt + key-req. */
  signMessage: SignMessageFn;
  /** How long to wait for the pool to flip to `fetched`. Default 30000 ms. */
  pollTimeoutMs?: number;
  /** Polling interval. Default 500 ms. */
  pollIntervalMs?: number;
}

export interface VerifiedResult {
  plaintext: Uint8Array;
  data: unknown;
  metadata: PoolMetadata;
  verified: true;
}

/**
 * Coalescing read-flow. Pass in a `PoolClient` + the canonical request and
 * a wallet-signing function; get back verified plaintext.
 *
 * The singleflight is bound to this orchestrator's lifetime — pass a shared
 * instance across calls to coalesce across them.
 */
export class FetchAndVerify {
  private readonly inflight = new Singleflight<VerifiedResult>();

  constructor(private readonly client: PoolClient) {}

  async run(input: FetchAndVerifyInput): Promise<VerifiedResult> {
    const key = hashRequestV2Hex({
      providerId: input.providerId,
      method: (input.method ?? "GET").toUpperCase(),
      endpoint: input.endpoint,
      params: input.params ?? {},
      freshnessWindowSecs: input.freshnessWindowSecs,
    });
    return this.inflight.do(key, () => this.runOnce(input, key));
  }

  /** Number of distinct in-flight keys — for tests + observability. */
  get inflightSize(): number {
    return this.inflight.size;
  }

  private async runOnce(
    input: FetchAndVerifyInput,
    expectedHashHex: string
  ): Promise<VerifiedResult> {
    // 1) submit the request — server returns the pool hash + status
    const req = await this.client.submitRequest({
      endpoint: input.endpoint,
      params: input.params,
      buyerPubkey: input.buyer,
      method: input.method,
      dataType: input.dataType,
      freshnessWindowSecs: input.freshnessWindowSecs,
    });
    if (req.poolHash !== expectedHashHex) {
      throw new DataPoolHashMismatchError(expectedHashHex, req.poolHash);
    }

    // 2) sign + submit the receipt so the buyer is authorized for key delivery
    const nowSec = Math.floor(Date.now() / 1000);
    const deadline = BigInt(
      nowSec + (input.receiptDeadlineFromNowSecs ?? 600)
    );
    const nonce = BigInt(Date.now());
    const receipt: JoinReceipt = {
      poolHash: hexToBytes(req.poolHash),
      buyer: input.buyer,
      maxPrice: input.maxPrice,
      nonce,
      deadline,
    };
    const receiptBytes = serializeReceipt(receipt);
    const { signature: receiptSig } = await input.signMessage(receiptBytes);
    const receiptWire: ReceiptWire = {
      poolHash: req.poolHash,
      buyer: input.buyer,
      maxPrice: input.maxPrice.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signedMessage: hexFromBytes(receiptBytes),
      signature: hexFromBytes(receiptSig),
    };
    await this.client.submitReceipt(receiptWire);

    // 3) poll metadata until the pool is fetched (or timeout)
    const meta = await this.pollUntilFetched(
      req.poolHash,
      input.pollTimeoutMs ?? 30_000,
      input.pollIntervalMs ?? 500
    );
    if (!meta.dataHash || !meta.payloadUrl) {
      throw new Error("PoolMetadata missing dataHash/payloadUrl after fetch");
    }

    // 4) derive x25519 keypair + sign key-req
    const { secret: buyerSecret, pubkey: buyerPub } = await deriveBuyerX25519(
      input.signMessage
    );
    const encPubHex = bytesToHex(buyerPub);
    const keyNonce = BigInt(Date.now());
    const keyMsg = buildKeyReqMessage(req.poolHash, encPubHex, keyNonce);
    const { signature: keySig } = await input.signMessage(keyMsg);

    // 5) request wrapped K_pool
    const keyRes = await this.client.requestKey(req.poolHash, {
      buyer: input.buyer,
      encPubkey: encPubHex,
      nonce: keyNonce.toString(),
      signature: bytesToHex(keySig),
    });

    // 6) fetch encrypted payload + envelope headers
    const payload = await this.client.getPayload(req.poolHash);
    const ivHex = payload.headers.get("X-DataPool-IV");
    if (!ivHex) throw new Error("Missing X-DataPool-IV header");
    const iv = hexToBytes(ivHex);

    // 7) unwrap K_pool + check commitment + decrypt
    const wrapped = hexToBytes(keyRes.wrappedKey);
    const poolKey = unwrapPoolKey(wrapped, buyerSecret);
    if (!checkKeyCommitment(poolKey, hexToBytes(keyRes.keyCommitment))) {
      throw new KeyCommitmentError();
    }
    const plaintext = decryptPayload(poolKey, iv, payload.bytes);

    // 8) envelope + data_hash verification
    const sourceUrl = payload.headers.get("X-DataPool-Source-Url");
    const fetchedAtRaw = payload.headers.get("X-DataPool-Fetched-At");
    const expiresAtRaw = payload.headers.get("X-DataPool-Expires-At");
    const merkleRootHex = payload.headers.get("X-DataPool-Merkle-Root");
    const keeperPubkeyHex = payload.headers.get("X-DataPool-Keeper-Pubkey");
    const keeperSignatureHex = payload.headers.get(
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
    if (!envCheck.ok) {
      throw new DataEnvelopeVerificationError(envCheck.reason);
    }

    const actualHashHex = await sha256Hex(plaintext);
    if (actualHashHex !== meta.dataHash) {
      throw new DecryptDataHashMismatchError(meta.dataHash, actualHashHex);
    }

    const contentType =
      payload.headers.get("X-DataPool-Plaintext-Type") ?? "";
    let data: unknown = plaintext;
    if (contentType.includes("application/json")) {
      data = JSON.parse(new TextDecoder().decode(plaintext));
    }

    return { plaintext, data, metadata: meta, verified: true };
  }

  private async pollUntilFetched(
    hash: string,
    timeoutMs: number,
    intervalMs: number
  ): Promise<PoolMetadata> {
    const deadline = Date.now() + timeoutMs;
    let last: PoolMetadata | undefined;
    while (Date.now() < deadline) {
      const meta = await this.client.getPoolMetadata(hash);
      last = meta;
      if (meta.status === "fetched" && meta.dataHash && meta.payloadUrl) {
        return meta;
      }
      if (meta.status === "closed") {
        throw new Error(`Pool ${hash.slice(0, 8)} closed before fetch`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `Pool ${hash.slice(0, 8)} did not become 'fetched' within ${timeoutMs}ms ` +
        `(last status: ${last?.status})`
    );
  }
}
