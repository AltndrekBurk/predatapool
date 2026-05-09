"use client";

import { useState } from "react";
import { GridBackground } from "./components/grid-background";
import { ThemeToggle } from "./components/theme-toggle";
import { ClusterSelect } from "./components/cluster-select";
import { WalletButton } from "./components/wallet-button";
import { DatapoolRequestForm } from "./components/datapool-request-form";
import { PoolList } from "./components/pool-list";
import { KpiStrip } from "./components/kpi-strip";
import { type RequestResponse } from "./lib/server-api";

export default function Home() {
  const [poolRefreshKey, setPoolRefreshKey] = useState(0);

  const handlePoolJoined = (_res: RequestResponse) => {
    setPoolRefreshKey((k) => k + 1);
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />

      <div className="relative z-10">
        {/* Header */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black tracking-tight">DataPool</span>
            <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              devnet
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <ClusterSelect />
            <WalletButton />
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6">
          {/* Hero */}
          <section className="pt-6 pb-10 md:pt-8 md:pb-14">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-border-low bg-cream/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                  x402-MPP · Solana L2
                </p>
                <h1 className="font-black tracking-tight text-foreground">
                  <span className="block text-5xl md:text-6xl">Pay once.</span>
                  <span className="block text-6xl md:text-7xl text-foreground/50">
                    Share N ways.
                  </span>
                </h1>
              </div>

              <div className="max-w-lg space-y-3">
                <p className="text-sm leading-relaxed text-foreground/60">
                  An aggregation layer for x402-priced HTTP endpoints. N agents
                  asking for the same data → one upstream fetch, one payment,
                  payload + on-chain hash served to all. Light Protocol
                  compressed accounts drop both payment fees and compute costs.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Request dedup (canonical key)",
                    "x402 payment loop",
                    "Cache + reuse-fee TTL",
                    "Hash-verified payload",
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-cream px-3 py-1 text-xs font-medium text-foreground/60"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* KPI strip — live savings story */}
          <KpiStrip />

          {/* Main content */}
          <div className="mt-10 space-y-10 pb-24">
            {/* How it saves */}
            <section className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Pool",
                  desc: "Buyers requesting the same canonical key (provider+method+path+params+freshness) land in the same pool.",
                },
                {
                  step: "02",
                  title: "Pay & Fetch",
                  desc: "Threshold met → keeper pays the upstream once via @solana/mpp, downloads, registers data_hash + storage_uri on-chain.",
                },
                {
                  step: "03",
                  title: "Reuse",
                  desc: "Within the freshness window, every later buyer is a cache hit — same payload, decayed reuse fee, sponsors rebated.",
                },
              ].map(({ step, title, desc }) => (
                <div
                  key={step}
                  className="rounded-2xl border border-border-low bg-card p-5 space-y-2"
                >
                  <p className="font-mono text-xs text-muted">{step}</p>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-xs leading-relaxed text-muted">{desc}</p>
                </div>
              ))}
            </section>

            {/* Request form + pool list */}
            <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
              <DatapoolRequestForm onPoolJoined={handlePoolJoined} />
              <PoolList refreshKey={poolRefreshKey} />
            </div>

            {/* Program info */}
            <section className="rounded-2xl border border-border-low bg-card p-6 space-y-4">
              <p className="text-sm font-semibold">On-chain Program</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                <InfoRow
                  label="Program ID"
                  value="62pKxmwZ...Kg4D"
                  mono
                />
                <InfoRow label="Network" value="Devnet" />
                <InfoRow label="Framework" value="Anchor 0.32.1" />
                <InfoRow label="Token" value="USDC (SPL)" />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href="https://explorer.solana.com/address/62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D?cluster=devnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-cream px-3 py-1.5 text-xs font-medium transition hover:bg-cream/70"
                >
                  View on Explorer ↗
                </a>
                <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                  Fund keeper wallet to deploy → faucet.solana.com
                </span>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-cream/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-xs font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}
