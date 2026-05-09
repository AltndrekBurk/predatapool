"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useWallet } from "../lib/wallet/context";
import {
  submitRequest,
  type DataType,
  type RequestResponse,
} from "../lib/server-api";
import {
  poolLifecycle,
  LIFECYCLE_LABEL,
  LIFECYCLE_BADGE,
} from "../lib/lifecycle";

const DATA_TYPE_LABELS: Record<DataType, string> = {
  weather: "Weather (100 bps/hr decay)",
  gps_rtk: "GPS/RTK (667 bps/hr)",
  map_imagery: "Map Imagery (1 bps/hr)",
  iot_sensor: "IoT Sensor (200 bps/hr)",
  api_response: "API Response (500 bps/hr)",
};

interface Props {
  onPoolJoined?: (response: RequestResponse) => void;
}

export function DatapoolRequestForm({ onPoolJoined }: Props) {
  const { wallet, status } = useWallet();
  const [endpoint, setEndpoint] = useState("");
  const [paramsRaw, setParamsRaw] = useState("");
  const [dataType, setDataType] = useState<DataType>("api_response");
  const [loading, setLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<RequestResponse | null>(null);

  const address = wallet?.account.address;

  const handleSubmit = useCallback(async () => {
    if (!endpoint || !address) return;

    let params: Record<string, string> = {};
    if (paramsRaw.trim()) {
      try {
        params = JSON.parse(paramsRaw);
      } catch {
        toast.error("Invalid params JSON. Use {\"key\": \"value\"} format.");
        return;
      }
    }

    setLoading(true);
    try {
      const res = await submitRequest(endpoint, params, address, dataType);
      setLastResponse(res);
      onPoolJoined?.(res);
      toast.success(res.isNewPool ? "New pool created!" : "Joined existing pool!", {
        description: `Pool ${res.poolHash.slice(0, 16)}... · ${res.currentPriceFormatted}`,
      });
    } catch (err) {
      toast.error("Request failed", {
        description: String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [endpoint, paramsRaw, address, dataType, onPoolJoined]);

  if (status !== "connected") {
    return (
      <section className="w-full space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Request Data</p>
        <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
          Connect your wallet to request data
        </div>
      </section>
    );
  }

  return (
    <section className="w-full space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="space-y-1">
        <p className="text-lg font-semibold">Find or Create Pool</p>
        <p className="text-sm text-muted">
          Submit an endpoint. Matching canonical key → join existing pool
          (cache hit if fresh). Otherwise → new pool, you become the first sponsor.
        </p>
      </div>

      {/* Savings preview — static at this stage; the real number lands in the
          response card once we know if it was a cache hit. */}
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">
          Why it's cheaper
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <SavingsCell label="Solo x402" value="$1.00" />
          <SavingsCell label="Pooled" value="≈ $0.50" highlight />
          <SavingsCell label="Cached" value="$0.00" highlight />
        </div>
        <p className="text-[11px] leading-relaxed text-green-700/80 dark:text-green-300/80">
          Solo = pay upstream every fetch. Pooled = N buyers share one fetch. Cached
          = inside the freshness window, payment is already done — just verify and sign.
        </p>
      </div>

      <div className="space-y-3">
        {/* Endpoint */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted uppercase tracking-wide">
            Endpoint URL
          </label>
          <input
            type="url"
            placeholder="https://api.weatherxm.com/api/v1/cells/..."
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-50"
          />
        </div>

        {/* Params */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted uppercase tracking-wide">
            Params (JSON, optional)
          </label>
          <input
            type="text"
            placeholder='{"lat": "41.0", "lng": "28.9"}'
            value={paramsRaw}
            onChange={(e) => setParamsRaw(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-50"
          />
        </div>

        {/* Data Type */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted uppercase tracking-wide">
            Data Type (decay rate)
          </label>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value as DataType)}
            disabled={loading}
            className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm outline-none transition focus:border-foreground/30 disabled:opacity-50"
          >
            {(Object.keys(DATA_TYPE_LABELS) as DataType[]).map((dt) => (
              <option key={dt} value={dt}>
                {DATA_TYPE_LABELS[dt]}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !endpoint}
          className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-xs transition hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
        >
          {loading ? "Submitting..." : "Find or Create Pool"}
        </button>
      </div>

      {/* Last response */}
      {lastResponse && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            lastResponse.cacheHit
              ? "border-green-500/30 bg-green-500/5"
              : "border-border-low bg-cream/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              {lastResponse.cacheHit ? "Cache hit" : "Pool result"}
            </span>
            <ResponseLifecycleBadge response={lastResponse} />
          </div>
          {lastResponse.cacheHit && (
            <p className="text-xs text-green-700 dark:text-green-300">
              Payment already settled · pull payload from cache, verify hash, sign receipt.
            </p>
          )}
          <p className="font-mono text-xs text-foreground/70 truncate">
            {lastResponse.poolHash}
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Buyers" value={String(lastResponse.buyerCount)} />
            <Stat label="Price" value={lastResponse.currentPriceFormatted} />
            <Stat
              label="Fetch"
              value={
                lastResponse.cacheHit
                  ? "Skipped (cached)"
                  : lastResponse.fetchTriggered
                    ? "Triggered"
                    : "Waiting"
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}

function ResponseLifecycleBadge({ response }: { response: RequestResponse }) {
  // The /request response only carries `status` + `expiresAt`. Reuse the
  // shared lifecycle vocabulary so the badge here matches the pool card.
  const lc = poolLifecycle(response.status, response.expiresAt);
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${LIFECYCLE_BADGE[lc]}`}
    >
      {LIFECYCLE_LABEL[lc]}
    </span>
  );
}

function SavingsCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-2 py-2 ${
        highlight ? "bg-green-500/10" : "bg-cream/40"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-0.5 text-sm font-bold tabular-nums ${
          highlight ? "text-green-700 dark:text-green-300" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
