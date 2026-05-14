/**
 * App-side re-export of the SDK's canonical JoinReceipt. The wire format is
 * the protocol's source of truth and lives in `@predatapool/sdk` so the
 * server, this app, and any third-party M2M client share one definition.
 */

export {
  RECEIPT_DOMAIN,
  RECEIPT_DOMAIN_LEN,
  RECEIPT_BYTES,
  serializeReceipt,
  isReceiptFresh,
  hexFromBytes,
  bytesFromHex,
} from "@predatapool/sdk";
export type { JoinReceipt } from "@predatapool/sdk";
