"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useWallet } from "../lib/wallet/context";
import {
  submitRequest,
  type DataType,
  type RequestResponse,
} from "../lib/server-api";

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
        <p className="text-lg font-semibold">Request Data</p>
        <p className="text-sm text-muted">
          Submit a data endpoint. If others want the same data, your costs are pooled.
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
          {loading ? "Submitting..." : "Submit Request"}
        </button>
      </div>

      {/* Last response */}
      {lastResponse && (
        <div className="rounded-xl border border-border-low bg-cream/30 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Pool Result
            </span>
            <StatusBadge status={lastResponse.status} />
          </div>
          <p className="font-mono text-xs text-foreground/70 truncate">
            {lastResponse.poolHash}
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Buyers" value={String(lastResponse.buyerCount)} />
            <Stat label="Price" value={lastResponse.currentPriceFormatted} />
            <Stat
              label="Fetch"
              value={lastResponse.fetchTriggered ? "Triggered" : "Waiting"}
            />
          </div>
        </div>
      )}
    </section>
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
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${colors[status] ?? "bg-cream text-muted"}`}
    >
      {status}
    </span>
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
