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
import { useCluster } from "./cluster-context";

// Base price per pool: 1 USDC = 1_000_000 micro-USDC
const BASE_PRICE_USDC = 1_000_000;
const MIN_BUYERS = 2;

interface Props {
  pool: Pool;
  onJoined?: () => void;
}

export function PoolCard({ pool, onJoined }: Props) {
  const { wallet } = useWallet();
  const { getExplorerUrl } = useCluster();
  const [joining, setJoining] = useState(false);

  const address = wallet?.account.address;
  const isUserInPool = address ? pool.buyers.includes(address) : false;

  const progress = Math.min(1, pool.buyers.length / MIN_BUYERS);
  const progressPercent = Math.round(progress * 100);

  const hoursElapsed = pool.fetchedAt
    ? (Date.now() - pool.fetchedAt) / 3_600_000
    : 0;

  const handleJoin = async () => {
    if (!address) {
      toast.error("Connect your wallet first");
      return;
    }
    if (isUserInPool) {
      toast.info("Already in this pool");
      return;
    }

    setJoining(true);
    try {
      const res = await submitRequest(
        pool.endpoint,
        pool.params,
        address,
        "api_response" as DataType
      );
      toast.success("Joined pool!", {
        description: `${res.buyerCount} buyer${res.buyerCount !== 1 ? "s" : ""} · ${res.currentPriceFormatted}`,
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
            {pool.buyers.length}/{MIN_BUYERS} buyers
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

      {/* Actions */}
      <div className="flex gap-2">
        {pool.status !== "fetched" && (
          <button
            onClick={handleJoin}
            disabled={joining || isUserInPool || !address}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            {joining
              ? "Joining..."
              : isUserInPool
                ? "Joined"
                : !address
                  ? "Connect Wallet"
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
