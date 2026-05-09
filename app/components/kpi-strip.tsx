"use client";

import useSWR from "swr";
import { getPools } from "../lib/server-api";
import { computeKpis } from "../lib/lifecycle";

const POLL_INTERVAL_MS = 3_000;

/**
 * Headline savings strip — the x402-MPP elevator pitch in 4 numbers.
 *
 * Polls /pools and derives:
 *   - Pools active     : pooling | fetching | cached
 *   - Agents joined    : sum of buyers across all pools
 *   - Fetches saved    : (buyers - 1) per fetched/fetching pool — every
 *                        extra buyer is a fetch + payment that didn't fire
 *   - Fees saved est   : fetches saved × per-fetch base USDC
 *
 * "Saved" is intentionally generous (vs vanilla x402-per-buyer); the demo
 * is selling the headline, the fine print is in the on-chain economics.
 */
export function KpiStrip() {
  const { data } = useSWR("pools-kpi", () => getPools(), {
    refreshInterval: POLL_INTERVAL_MS,
    revalidateOnFocus: false,
  });

  const kpis = computeKpis(data?.pools ?? []);
  const feesUsd = kpis.feesSavedMicroUsdc / 1_000_000;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Pools active" value={kpis.poolsActive.toString()} />
      <Kpi label="Agents joined" value={kpis.agentsJoined.toString()} />
      <Kpi
        label="Fetches saved"
        value={kpis.fetchesSaved.toString()}
        accent
      />
      <Kpi
        label="Est. fees saved"
        value={`$${feesUsd.toFixed(2)}`}
        accent
      />
    </section>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent
          ? "border-green-500/30 bg-green-500/5"
          : "border-border-low bg-card"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          accent ? "text-green-700 dark:text-green-300" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
