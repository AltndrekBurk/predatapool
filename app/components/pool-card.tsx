"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWallet } from "../lib/wallet/context";
import {
  submitRequest,
  formatUsdc,
  type Pool,
  type DataType,
} from "../lib/server-api";
import { useSignReceipt, toWire } from "../lib/hooks/use-sign-receipt";
import { useApproveDelegate, DEFAULT_APPROVAL_CAP } from "../lib/hooks/use-approve-delegate";
import { bytesFromHex, type JoinReceipt } from "../lib/receipt";
import { useCluster } from "./cluster-context";

// Base price per pool: 1 USDC = 1_000_000 micro-USDC
const BASE_PRICE_USDC = 1_000_000;
const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

/**
 * Generate a 64-bit nonce for receipt replay protection. Random is fine —
 * collision probability over a single buyer's lifetime is negligible.
 */
function makeNonce(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(buf[i]);
  return n;
}

interface Props {
  pool: Pool;
  onJoined?: () => void;
}

export function PoolCard({ pool, onJoined }: Props) {
  const { wallet } = useWallet();
  const { getExplorerUrl } = useCluster();
  const { signReceipt, canSign } = useSignReceipt();
  const { hasApproval, delegatedAmount, approve, isApproving } =
    useApproveDelegate();
  const [joining, setJoining] = useState(false);

  const address = wallet?.account.address;
  const isUserInPool = address ? pool.buyers.includes(address) : false;
  const needsApproval = !hasApproval(BigInt(BASE_PRICE_USDC));

  // Server pool state may pre-date the minBuyers field — default to 2 for
  // older entries returned by /pools, matching the legacy threshold.
  const minBuyers = pool.minBuyers ?? 2;
  const progress = Math.min(1, pool.buyers.length / minBuyers);
  const progressPercent = Math.round(progress * 100);

  const hoursElapsed = pool.fetchedAt
    ? (Date.now() - pool.fetchedAt) / 3_600_000
    : 0;

  const handleApprove = async () => {
    try {
      const sig = await approve(DEFAULT_APPROVAL_CAP);
      toast.success("Spending authorized", {
        description: (
          <a
            href={getExplorerUrl(`/tx/${sig}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View transaction
          </a>
        ),
      });
    } catch (err) {
      toast.error("Authorization failed", { description: String(err) });
    }
  };

  const handleJoin = async () => {
    if (!address) {
      toast.error("Connect your wallet first");
      return;
    }
    if (isUserInPool) {
      toast.info("Already in this pool");
      return;
    }
    if (!canSign) {
      toast.error("Wallet does not support message signing");
      return;
    }
    if (needsApproval) {
      toast.error("Authorize spending first", {
        description: "One-time approval — covers all pools, all data types.",
      });
      return;
    }

    setJoining(true);
    try {
      // 1. Off-chain matcher join — keeps the existing pool lifecycle
      //    (lazy create + on-chain initialize + fetch-trigger when threshold met).
      const matcherRes = await submitRequest(
        pool.endpoint,
        pool.params,
        address,
        "api_response" as DataType
      );

      // 2. Sign the canonical receipt — buyer authorizes settle_receipt.
      //    Deadline is 10 min; max_price floored at base so post-fetch decay
      //    can only ever decrease the actual amount pulled.
      const receipt: JoinReceipt = {
        poolHash: bytesFromHex(matcherRes.poolHash),
        buyer: address,
        maxPrice: BigInt(BASE_PRICE_USDC),
        nonce: makeNonce(),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      };
      const signed = await signReceipt(receipt);

      // 3. POST signed receipt to server — scheduler will pack it into the
      //    next settle_receipt tx. Buyer never waits on chain confirmation.
      const wire = toWire(signed);
      const res = await fetch(`${SERVER_URL}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wire),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      toast.success("Joined pool!", {
        description: `${matcherRes.buyerCount} buyer${matcherRes.buyerCount !== 1 ? "s" : ""} · ${matcherRes.currentPriceFormatted}`,
      });
      onJoined?.();
    } catch (err) {
      toast.error("Join failed", { description: String(err) });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border-low bg-card p-5 space-y-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.2)]">
      {/* Status + Data Type */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <StatusDot status={pool.status} />
            <span className="font-mono text-xs text-muted truncate">
              {pool.requestHash.slice(0, 8)}...{pool.requestHash.slice(-6)}
            </span>
          </div>
          <p className="text-sm font-medium truncate" title={pool.endpoint}>
            {shortenEndpoint(pool.endpoint)}
          </p>
        </div>
        <StatusBadge status={pool.status} />
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>
            {pool.buyers.length}/{minBuyers} buyers
          </span>
          <span>{progressPercent}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-cream overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pool.status === "fetched"
                ? "bg-green-500"
                : pool.status === "fetching"
                  ? "bg-blue-500 animate-pulse"
                  : "bg-primary"
            }`}
            style={{ width: `${pool.status === "fetched" ? 100 : progressPercent}%` }}
          />
        </div>
      </div>

      {/* Price */}
      <div className="rounded-xl bg-cream/40 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted">
          {pool.status === "fetched" ? "Current Price (time-decayed)" : "Base Price"}
        </p>
        <p className="mt-0.5 text-xl font-bold tabular-nums">
          {formatUsdc(BASE_PRICE_USDC)}
        </p>
        {pool.status === "fetched" && hoursElapsed > 0 && (
          <p className="mt-0.5 text-xs text-muted">
            {hoursElapsed.toFixed(1)}h since fetch
          </p>
        )}
      </div>

      {/* Data hash if fetched */}
      {pool.dataHash && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-green-600 dark:text-green-400 mb-0.5">
            Data Hash (on-chain)
          </p>
          <p className="font-mono text-xs text-foreground/70 break-all">
            {pool.dataHash.slice(0, 32)}...
          </p>
        </div>
      )}

      {/* Approval gate (one-time; covers all pools) */}
      {address && needsApproval && pool.status !== "fetched" && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300 space-y-2">
          <p>
            One-time spending authorization required. Approve up to{" "}
            <span className="font-mono">
              ${(Number(DEFAULT_APPROVAL_CAP) / 1_000_000).toFixed(2)} USDC
            </span>{" "}
            for the protocol to settle pool joins on your behalf — no per-pool wallet signature.
          </p>
          <button
            onClick={handleApprove}
            disabled={isApproving}
            className="w-full rounded-md bg-yellow-500/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-yellow-500/25 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isApproving ? "Authorizing..." : "Authorize Spending"}
          </button>
        </div>
      )}

      {address && !needsApproval && pool.status !== "fetched" && (
        <p className="text-xs text-muted">
          Authorized:{" "}
          <span className="font-mono">
            ${(Number(delegatedAmount) / 1_000_000).toFixed(2)} USDC
          </span>{" "}
          remaining allowance
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {pool.status !== "fetched" && (
          <button
            onClick={handleJoin}
            disabled={joining || isUserInPool || !address || needsApproval}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            {joining
              ? "Joining..."
              : isUserInPool
                ? "Joined"
                : !address
                  ? "Connect Wallet"
                  : needsApproval
                    ? "Authorize First"
                    : "Join Pool"}
          </button>
        )}

        {pool.status === "fetched" && isUserInPool && (
          <button
            disabled
            title="Claim rebate via on-chain instruction after devnet deploy"
            className="flex-1 rounded-lg border border-border-low bg-cream px-4 py-2 text-sm font-medium transition hover:bg-cream/70 disabled:opacity-60"
          >
            Claim Rebate (deploy first)
          </button>
        )}

        <a
          href={getExplorerUrl(`/address/${pool.requestHash}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium text-muted transition hover:bg-cream hover:text-foreground"
        >
          Explorer ↗
        </a>
      </div>

      {/* Params if any */}
      {Object.keys(pool.params ?? {}).length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted hover:text-foreground list-none flex items-center gap-1">
            <span className="transition group-open:rotate-90">▶</span>
            Params
          </summary>
          <pre className="mt-2 rounded-lg bg-cream/50 p-3 font-mono text-xs text-foreground/70 overflow-auto">
            {JSON.stringify(pool.params, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-400",
    fetching: "bg-blue-400 animate-pulse",
    fetched: "bg-green-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${colors[status] ?? "bg-muted"}`}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    fetching: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    fetched: "bg-green-500/15 text-green-600 dark:text-green-400",
  };
  return (
    <span
      className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${colors[status] ?? "bg-cream text-muted"}`}
    >
      {status}
    </span>
  );
}

function shortenEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 30) + (u.pathname.length > 30 ? "…" : "");
  } catch {
    return url.slice(0, 40);
  }
}
