import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";

/**
 * Surface a readable message from arbitrary tx errors.
 *
 * For Anchor custom program errors we expose the numeric code so the UI can
 * still differentiate failure modes; readable mappings should be sourced
 * from the generated client when one is wired up (none today — the app
 * talks to the DataPool program exclusively through the pool node's HTTP
 * surface, so on-chain CUSTOM errors only reach here via the wallet flow).
 */
export function parseTransactionError(err: unknown): string {
  if (err instanceof Error && err.message.includes("User rejected")) {
    return "Transaction was rejected by the wallet.";
  }

  if (
    isSolanaError(err, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
    typeof err.context?.code === "number"
  ) {
    return `Program error (code ${err.context.code})`;
  }

  const message = getDeepestMessage(err);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

function getDeepestMessage(err: unknown): string {
  let deepest = err instanceof Error ? err.message : String(err);
  let current: unknown = err;
  while (current instanceof Error && current.cause) {
    current = current.cause;
    if (current instanceof Error) {
      deepest = current.message;
    }
  }
  return deepest;
}
