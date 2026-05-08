"use client";

import { useCallback } from "react";
import { useWallet } from "../wallet/context";
import {
  serializeReceipt,
  hexFromBytes,
  type JoinReceipt,
} from "../receipt";

/**
 * Off-chain receipt signing.
 *
 * The buyer signs a 104-byte canonical JoinReceipt with their wallet's
 * Ed25519 key. The signature is then POSTed to the matching server,
 * which aggregates many receipts into a single on-chain settle_batch tx.
 *
 * This means joining N pools costs the buyer N wallet signatures (off-chain,
 * free) but only ~1 on-chain transaction across all batched buyers — the
 * energy-savings counterpart to x402's "fetch once, share among N".
 */
export function useSignReceipt() {
  const { wallet } = useWallet();

  const signReceipt = useCallback(
    async (
      receipt: JoinReceipt
    ): Promise<{
      receipt: JoinReceipt;
      message: Uint8Array;
      signedMessage: Uint8Array;
      signature: Uint8Array;
    }> => {
      if (!wallet?.signMessage) {
        throw new Error("Wallet does not support message signing");
      }

      const message = serializeReceipt(receipt);
      const { signedMessage, signature } = await wallet.signMessage(message);

      // Most Solana wallets return signedMessage === message verbatim.
      // If a wallet adds a prefix, the on-chain Ed25519 precompile must
      // verify against signedMessage, not the original. We surface both
      // so the caller can reject prefixed wallets if strict verification
      // is required (the on-chain ix will use signedMessage).
      if (signedMessage.length !== message.length) {
        console.warn(
          `[receipt] wallet signed ${signedMessage.length} bytes, expected ${message.length} — ` +
            "wallet appears to prefix messages. Server-side verification will use signedMessage."
        );
      }

      return { receipt, message, signedMessage, signature };
    },
    [wallet]
  );

  return {
    signReceipt,
    canSign: !!wallet?.signMessage,
  };
}

/**
 * Wire format for POSTing a signed receipt to the server.
 * All byte arrays are hex-encoded so the JSON survives transport.
 */
export interface SignedReceiptWire {
  poolHash: string; // 32-byte hex
  buyer: string; // base58 address
  maxPrice: string; // u64 as decimal string (JSON loses precision on bigint)
  nonce: string;
  deadline: string;
  signedMessage: string; // hex
  signature: string; // 64-byte hex
}

export function toWire(signed: {
  receipt: JoinReceipt;
  signedMessage: Uint8Array;
  signature: Uint8Array;
}): SignedReceiptWire {
  return {
    poolHash: hexFromBytes(signed.receipt.poolHash),
    buyer: signed.receipt.buyer,
    maxPrice: signed.receipt.maxPrice.toString(),
    nonce: signed.receipt.nonce.toString(),
    deadline: signed.receipt.deadline.toString(),
    signedMessage: hexFromBytes(signed.signedMessage),
    signature: hexFromBytes(signed.signature),
  };
}
