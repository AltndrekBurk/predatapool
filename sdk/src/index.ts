/**
 * @predatapool/sdk — public surface.
 *
 * Solana-native request coalescing for DePIN, IoT, and edge compute.
 * `PoolClient` wraps the pool node's HTTP API (with in-tab Singleflight
 * on submitRequest); `Singleflight` is also exported standalone for
 * arbitrary coalescing use cases.
 */

export { PoolClient } from "./client.js";
export type {
  PoolClientOptions,
  SubmitRequestInput,
  ReceiptWire,
} from "./client.js";

export { Singleflight } from "./coalesce.js";

export {
  hashRequestV2,
  hashRequestV2Hex,
  buildCanonicalRequest,
  REQUEST_KEY_DOMAIN,
} from "./request-key.js";
export type { RequestKeyInput, CanonicalRequest } from "./request-key.js";

export {
  RECEIPT_DOMAIN,
  RECEIPT_BYTES,
  RECEIPT_DOMAIN_LEN,
  serializeReceipt,
  isReceiptFresh,
  hexFromBytes,
  bytesFromHex,
} from "./receipt.js";
export type { JoinReceipt } from "./receipt.js";

export {
  buildDataEnvelopeV0,
  verifyDataEnvelopeV0,
  envelopeRoot,
  sha256Bytes,
} from "./envelope.js";
export type { DataEnvelopeV0, KeeperKey } from "./envelope.js";

export {
  KEY_COMMITMENT_DOMAIN,
  WRAP_HKDF_INFO,
  X25519_DERIVE_INFO,
  KEY_REQ_DOMAIN,
  X25519_DERIVE_MESSAGE,
  POOL_KEY_BYTES,
  PAYLOAD_IV_BYTES,
  X25519_KEY_BYTES,
  WRAPPED_KEY_BYTES,
  deriveBuyerX25519,
  unwrapPoolKey,
  keyCommitment,
  checkKeyCommitment,
  decryptPayload,
  verifyEnvelopeRootFromHeaders,
  buildKeyReqMessage,
  sha256Hex,
  hexToBytes,
  bytesToHex,
  bytesEqual,
  concatBytes,
} from "./crypto.js";
export type { X25519Keypair, SignMessageFn } from "./crypto.js";

export {
  KeyCommitmentError,
  DecryptDataHashMismatchError,
  DataEnvelopeVerificationError,
  DataPoolHashMismatchError,
  PoolMetadataVersionError,
} from "./errors.js";

export type {
  PoolStatus,
  DataType,
  Pool,
  PoolsResponse,
  RequestResponse,
  PoolMetadata,
  BatchInfo,
} from "./types.js";
