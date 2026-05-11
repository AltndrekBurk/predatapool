"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useWallet } from "../lib/wallet/context";
import {
  submitRequest,
  formatUsdc,
  getPoolMetadata,
  type Pool,
  type DataType,
  type PoolMetadata,
} from "../lib/server-api";
import {
  fetchDecryptAndVerify,
  KeyCommitmentError,
  DecryptDataHashMismatchError,
  DataEnvelopeVerificationError,
} from "../lib/crypto";
import { useSignReceipt, toWire } from "../lib/hooks/use-sign-receipt";
import { useApproveDelegate, DEFAULT_APPROVAL_CAP } from "../lib/hooks/use-approve-delegate";
import { bytesFromHex, type JoinReceipt } from "../lib/receipt";
import { findPoolPda } from "../lib/program";
import { useCluster } from "./cluster-context";
import {
  poolLifecycle,
  LIFECYCLE_LABEL,
  LIFECYCLE_DESCRIPTION,
  LIFECYCLE_BADGE,
  LIFECYCLE_DOT,
  type Lifecycle,
} from "../lib/lifecycle";

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
  const [nowMs, setNowMs] = useState(() => Date.now());

  const address = wallet?.account.address;
  const isUserInPool = address ? pool.buyers.includes(address) : false;
  const isUserAuthorized = address
    ? (pool.authorizedBuyers ?? []).includes(address)
    : false;
  const needsApproval = !hasApproval(BigInt(BASE_PRICE_USDC));

  const lifecycle: Lifecycle = poolLifecycle(pool.status, pool.expiresAt);
  const isCached = lifecycle === "cached";
  const isStale = lifecycle === "stale";
  const isFetched = pool.status === "fetched";

  // Pull on-chain-published metadata when the pool has been fetched.
  // Source of truth for storage_uri (in production = IPFS CID; for now =
  // server payload URL written by register_dataset).
  const { data: metadata } = useSWR<PoolMetadata>(
    isFetched ? ["pool-metadata", pool.requestHashHex] : null,
    () => getPoolMetadata(pool.requestHashHex),
    { revalidateOnFocus: false, refreshInterval: 5_000 }
  );

  // Derive the on-chain DataPool PDA — that's what the Explorer link should
  // point at, not the raw 32-byte request_hash (which isn't an account).
  const [poolPda, setPoolPda] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    findPoolPda(bytesFromHex(pool.requestHashHex))
      .then((pda) => {
        if (!cancelled) setPoolPda(pda.toString());
      })
      .catch(() => {
        // Bad hex — leave undefined; the explorer link falls back to omitted.
      });
    return () => {
      cancelled = true;
    };
  }, [pool.requestHashHex]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Local verification state — drives the Verify Payload button + result line.
  type VerifyState =
    | { status: "idle" }
    | { status: "verifying" }
    | { status: "ok"; bytesLength: number }
    | { status: "mismatch"; expected: string; actual: string }
    | { status: "error"; message: string };
  const [verify, setVerify] = useState<VerifyState>({ status: "idle" });

  const handleVerify = async () => {
    if (!metadata?.dataHash) {
      toast.error("Pool not yet fetched — nothing to verify");
      return;
    }
    if (!isUserAuthorized || !address) {
      toast.error("Submit a signed receipt first to decrypt and verify");
      return;
    }
    if (!wallet?.signMessage) {
      toast.error("Wallet does not support message signing");
      return;
    }
    setVerify({ status: "verifying" });
    try {
      const result = await fetchDecryptAndVerify({
        poolHashHex: pool.requestHashHex,
        buyerPubkey: address,
        dataHash: metadata.dataHash,
        signMessage: wallet.signMessage.bind(wallet),
        walletRef: wallet,
      });
      setVerify({ status: "ok", bytesLength: result.plaintext.length });
      toast.success("Decrypted · hash matches on-chain", {
        description: `${result.plaintext.length} bytes verified`,
      });
    } catch (err) {
      if (err instanceof KeyCommitmentError) {
        setVerify({ status: "error", message: err.message });
        toast.error("Key commitment mismatch — keeper may be lying", {
          description: err.message,
        });
      } else if (err instanceof DecryptDataHashMismatchError) {
        setVerify({
          status: "mismatch",
          expected: err.expected,
          actual: err.actual,
        });
        toast.error("Hash mismatch after decrypt", {
          description: `expected ${err.expected.slice(0, 12)}…, got ${err.actual.slice(0, 12)}…`,
        });
      } else if (err instanceof DataEnvelopeVerificationError) {
        setVerify({ status: "error", message: err.message });
        toast.error("Envelope verification failed", {
          description: err.message,
        });
      } else {
        const message = (err as Error).message ?? String(err);
        setVerify({ status: "error", message });
        toast.error("Verify failed", { description: message });
      }
    }
  };

  // Server pool state may pre-date the minBuyers field — default to 2 for
  // older entries returned by /pools, matching the legacy threshold.
  const minBuyers = pool.minBuyers ?? 2;
  const progress = Math.min(1, pool.buyers.length / minBuyers);
  const progressPercent = Math.round(progress * 100);

  const hoursElapsed = pool.fetchedAt
    ? (nowMs - pool.fetchedAt) / 3_600_000
    : 0;

  // Time left in the freshness window — drives the "Cached · expires in Nm" line.
  const msUntilExpiry =
    pool.expiresAt && pool.expiresAt > nowMs
      ? pool.expiresAt - nowMs
      : 0;
  const expiresInLabel = formatDuration(msUntilExpiry);

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
    if (isUserAuthorized) {
      toast.info("Receipt already submitted for this pool");
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
            <span
              className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${LIFECYCLE_DOT[lifecycle]}`}
            />
            <span className="font-mono text-xs text-muted truncate">
              {pool.requestHashHex.slice(0, 8)}...{pool.requestHashHex.slice(-6)}
            </span>
          </div>
          <p className="text-sm font-medium truncate" title={pool.endpoint}>
            {shortenEndpoint(pool.endpoint)}
          </p>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${LIFECYCLE_BADGE[lifecycle]}`}
          title={LIFECYCLE_DESCRIPTION[lifecycle]}
        >
          {LIFECYCLE_LABEL[lifecycle]}
        </span>
      </div>

      {/* Cache-hit savings callout — the headline x402-MPP message */}
      {isCached && (
        <div className="dp-anim-callout-in rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-green-700 dark:text-green-300">
            Cache hit · payment already settled
          </p>
          <p className="text-[11px] text-green-700/80 dark:text-green-300/80">
            Pull the payload from cache, verify against on-chain hash, sign a
            decayed-price receipt. No new upstream fetch.
          </p>
          {expiresInLabel && (
            <p className="text-[11px] text-green-700/60 dark:text-green-300/60">
              Window expires in <span className="font-mono">{expiresInLabel}</span>
            </p>
          )}
        </div>
      )}

      {isStale && (
        <div className="dp-anim-callout-in rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">
            Stale · freshness window elapsed
          </p>
          <p className="text-[11px] text-orange-700/80 dark:text-orange-300/80">
            Next request to this canonical key creates a fresh pool and triggers
            a new upstream fetch + payment.
          </p>
        </div>
      )}

      {metadata?.envelope && (
        <div className="rounded-xl border border-border-low bg-cream/30 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">DataEnvelope v{metadata.envelope.version}</p>
            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">
              keeper signed
            </span>
          </div>
          <div className="grid gap-1 text-[11px] text-muted">
            <p className="truncate" title={metadata.envelope.sourceUrl}>
              source {shortenEndpoint(metadata.envelope.sourceUrl)}
            </p>
            <p className="font-mono truncate" title={metadata.envelope.merkleRoot}>
              root {metadata.envelope.merkleRoot.slice(0, 16)}...
            </p>
          </div>
        </div>
      )}

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

      {/* Data hash + storage URI + Verify */}
      {pool.dataHash && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2.5 space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400">
              Data Hash (on-chain)
            </p>
            <p className="font-mono text-[11px] text-foreground/70 break-all">
              {pool.dataHash.slice(0, 32)}…
            </p>
          </div>

          {metadata?.storageUri && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400">
                Storage URI (on-chain)
              </p>
              <a
                href={metadata.storageUri}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-blue-600 dark:text-blue-400 underline break-all"
                title={metadata.storageUri}
              >
                {shortenStorageUri(metadata.storageUri)}
              </a>
            </div>
          )}

          {/* Verify Payload — pulls bytes, hashes locally, asserts match. */}
          <div className="pt-1 flex items-center gap-2">
            <button
              onClick={handleVerify}
              disabled={
                verify.status === "verifying" || !metadata?.payloadUrl
              }
              className="rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1 text-[11px] font-semibold text-green-700 dark:text-green-300 transition hover:bg-green-500/20 disabled:opacity-50 disabled:pointer-events-none"
            >
              {verify.status === "verifying"
                ? "Verifying…"
                : verify.status === "ok"
                  ? "Re-verify"
                  : "Verify Payload"}
            </button>
            <VerifyResultPill state={verify} />
          </div>
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
        {(lifecycle === "pooling" ||
          lifecycle === "fetching" ||
          lifecycle === "cached") && (
          <button
            onClick={handleJoin}
            disabled={joining || isUserAuthorized || !address || needsApproval}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            {joining
              ? lifecycle === "cached"
                ? "Settling..."
                : "Joining..."
              : isUserAuthorized
                ? lifecycle === "cached"
                  ? "Receipt ✓ Cached"
                  : "Receipt signed"
                : !address
                  ? "Connect Wallet"
                : needsApproval
                  ? "Authorize First"
                : isUserInPool
                  ? "Submit Receipt"
                  : lifecycle === "cached"
                    ? "Catch Cache Hit"
                      : lifecycle === "fetching"
                        ? "Wait for Fetch"
                        : "Join Pool"}
          </button>
        )}

        {lifecycle === "stale" && (
          <button
            disabled
            title="Submit a fresh request via the form — this pool's window has elapsed."
            className="flex-1 rounded-lg border border-border-low bg-cream/50 px-4 py-2 text-sm font-medium text-muted transition disabled:opacity-60"
          >
            Refetch via new request
          </button>
        )}

        {poolPda && (
          <a
            href={getExplorerUrl(`/address/${poolPda}`)}
            target="_blank"
            rel="noopener noreferrer"
            title={`On-chain DataPool PDA · ${poolPda}`}
            className="rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium text-muted transition hover:bg-cream hover:text-foreground"
          >
            Explorer ↗
          </a>
        )}
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

function VerifyResultPill({
  state,
}: {
  state:
    | { status: "idle" }
    | { status: "verifying" }
    | { status: "ok"; bytesLength: number }
    | { status: "mismatch"; expected: string; actual: string }
    | { status: "error"; message: string };
}) {
  if (state.status === "idle" || state.status === "verifying") return null;
  if (state.status === "ok") {
    return (
      <span
        className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-300"
        title={`${state.bytesLength} bytes hashed and matched on-chain data_hash`}
      >
        ✓ Hash matches
      </span>
    );
  }
  if (state.status === "mismatch") {
    return (
      <span
        className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300"
        title={`expected ${state.expected}\nactual   ${state.actual}`}
      >
        ✗ Slash signal
      </span>
    );
  }
  return (
    <span
      className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-300"
      title={state.message}
    >
      ✗ Verify error
    </span>
  );
}

function shortenStorageUri(uri: string): string {
  if (uri.length <= 40) return uri;
  return `${uri.slice(0, 26)}…${uri.slice(-12)}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m ${totalSec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function shortenEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 30) + (u.pathname.length > 30 ? "…" : "");
  } catch {
    return url.slice(0, 40);
  }
}
