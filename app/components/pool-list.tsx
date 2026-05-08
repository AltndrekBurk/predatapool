"use client";

import useSWR from "swr";
import { getPools, type Pool } from "../lib/server-api";
import { PoolCard } from "./pool-card";

const POLL_INTERVAL_MS = 3_000;

interface Props {
  refreshKey?: number;
}

export function PoolList({ refreshKey }: Props) {
  const { data, error, isLoading, mutate } = useSWR(
    ["pools", refreshKey],
    () => getPools(),
    {
      refreshInterval: POLL_INTERVAL_MS,
      revalidateOnFocus: false,
    }
  );

  const pools = data?.pools ?? [];

  return (
    <section className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold">Active Pools</p>
          <p className="text-sm text-muted">
            {isLoading
              ? "Loading..."
              : error
                ? "Server offline — start with: cd server && npm run dev"
                : `${pools.length} pool${pools.length !== 1 ? "s" : ""} · auto-refreshing`}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-lg border border-border-low bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-cream"
        >
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center space-y-2">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Matching server is not running
          </p>
          <pre className="text-xs text-muted font-mono">
            cd /home/burak/datapool-protocol/server{"\n"}
            npm run dev
          </pre>
        </div>
      )}

      {/* Empty state */}
      {!error && !isLoading && pools.length === 0 && (
        <div className="rounded-2xl border border-border-low bg-card p-10 text-center space-y-2">
          <p className="text-sm font-medium text-muted">No pools yet</p>
          <p className="text-xs text-muted">
            Submit a data request above to create the first pool.
          </p>
        </div>
      )}

      {/* Pool cards */}
      {pools.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pools
            .slice()
            .sort((a: Pool, b: Pool) => b.createdAt - a.createdAt)
            .map((pool: Pool) => (
              <PoolCard
                key={pool.requestHashHex}
                pool={pool}
                onJoined={() => mutate()}
              />
            ))}
        </div>
      )}
    </section>
  );
}
