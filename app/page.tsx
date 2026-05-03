"use client";

import { useState } from "react";
import { GridBackground } from "./components/grid-background";
import { ThemeToggle } from "./components/theme-toggle";
import { ClusterSelect } from "./components/cluster-select";
import { WalletButton } from "./components/wallet-button";
import { DatapoolRequestForm } from "./components/datapool-request-form";
import { PoolList } from "./components/pool-list";
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
          <section className="pt-6 pb-16 md:pt-8 md:pb-24">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="font-black tracking-tight text-foreground">
                  <span className="block text-5xl md:text-6xl">Buyer-Side</span>
                  <span className="block text-6xl md:text-7xl text-foreground/50">
                    Demand Pooling
                  </span>
                </h1>
              </div>

              <div className="max-w-lg space-y-3">
                <p className="text-sm leading-relaxed text-foreground/60">
                  Multiple buyers pool their demand for the same IoT/DePIN/API
                  data. One x402 fetch, shared cost, retroactive rebates for
                  early sponsors. Built on Solana.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Request deduplication",
                    "USDC escrow",
                    "Time-decay pricing",
                    "Retroactive rebates",
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

          {/* Main content */}
          <div className="space-y-10 pb-24">
            {/* How it works */}
            <section className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Submit Request",
                  desc: "Buyer submits a data endpoint. If a matching pool exists, they join it.",
                },
                {
                  step: "02",
                  title: "Pool Threshold",
                  desc: `Once ${2} buyers join, the keeper triggers a single x402 fetch and registers the dataset on-chain.`,
                },
                {
                  step: "03",
                  title: "Claim Rebate",
                  desc: "Early sponsors receive 30% of post-fetch revenue. Price decays over time to attract more buyers.",
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
