"use client";

import { useCallback, useEffect, useState } from "react";
import { type Address } from "@solana/kit";
import {
  getApproveInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
} from "@solana-program/token";
import { useWallet } from "../wallet/context";
import { useSendTransaction } from "./use-send-transaction";
import { useCluster } from "../../components/cluster-context";
import { getClusterUrl } from "../solana-client";
import { createSolanaRpc } from "@solana/kit";
import { findProtocolDelegatePda, USDC_MINT } from "../program";

/**
 * Default spending cap when the buyer approves the protocol delegate.
 * 1000 USDC = 1_000_000_000 micro-USDC. Caller can override.
 */
export const DEFAULT_APPROVAL_CAP = 1_000_000_000n;

interface ApprovalState {
  buyerAta: Address | null;
  delegate: Address | null;
  delegatedAmount: bigint;
  isLoading: boolean;
  error: unknown;
}

/**
 * Reads the buyer's USDC ATA's current delegate + delegated_amount, and
 * exposes an `approve(amount)` helper to (re)set them.
 *
 * The approval is one-time-per-cap: once the buyer approves N USDC,
 * settle_receipt will pull from this allowance until exhausted. Buyer
 * can re-approve to top up.
 */
export function useApproveDelegate() {
  const { signer } = useWallet();
  const { cluster } = useCluster();
  const { send, isSending } = useSendTransaction();

  const [state, setState] = useState<ApprovalState>({
    buyerAta: null,
    delegate: null,
    delegatedAmount: 0n,
    isLoading: false,
    error: undefined,
  });

  const refresh = useCallback(async () => {
    if (!signer) {
      setState((s) => ({ ...s, buyerAta: null, delegate: null, delegatedAmount: 0n }));
      return;
    }

    setState((s) => ({ ...s, isLoading: true, error: undefined }));
    try {
      const [buyerAta] = await findAssociatedTokenPda({
        owner: signer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: USDC_MINT,
      });
      const delegate = await findProtocolDelegatePda();

      // Fetch the ATA's current delegate state. If the ATA doesn't exist
      // yet (no USDC ever received), we fall back to "no approval".
      const rpc = createSolanaRpc(getClusterUrl(cluster));
      let delegatedAmount = 0n;
      let currentDelegate: Address | null = null;
      try {
        const account = await fetchToken(rpc, buyerAta);
        // `delegate` is an Option-like field; codama generates it as
        // { __option: 'Some'|'None', value?: Address }.
        const delegateOpt = (account.data as unknown as {
          delegate: { __option: string; value?: Address };
        }).delegate;
        if (delegateOpt.__option === "Some" && delegateOpt.value) {
          currentDelegate = delegateOpt.value;
        }
        delegatedAmount =
          (account.data as unknown as { delegatedAmount: bigint })
            .delegatedAmount ?? 0n;
      } catch {
        // ATA doesn't exist; values stay at defaults
      }

      setState({
        buyerAta,
        delegate: currentDelegate,
        delegatedAmount,
        isLoading: false,
        error: undefined,
      });
      // Stash the canonical delegate too so caller knows what we'd approve to
      return { buyerAta, expectedDelegate: delegate };
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: err }));
      return undefined;
    }
  }, [signer, cluster]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = useCallback(
    async (amountMicroUsdc: bigint = DEFAULT_APPROVAL_CAP) => {
      if (!signer) throw new Error("Wallet not connected");

      const [buyerAta] = await findAssociatedTokenPda({
        owner: signer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: USDC_MINT,
      });
      const delegate = await findProtocolDelegatePda();

      const ix = getApproveInstruction({
        source: buyerAta,
        delegate,
        owner: signer,
        amount: amountMicroUsdc,
      });

      const sig = await send({ instructions: [ix] });
      await refresh();
      return sig;
    },
    [signer, send, refresh]
  );

  return {
    ...state,
    isApproving: isSending,
    approve,
    refresh,
    /**
     * True if the buyer has already approved the canonical protocol delegate
     * with at least `minAmount` micro-USDC.
     */
    hasApproval: (minAmount: bigint = 1n) =>
      state.delegate != null && state.delegatedAmount >= minAmount,
  };
}
