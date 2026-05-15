import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentPrice,
  lambdaToQ16,
  DECAY_PRESETS,
  type DecayConfig,
} from "./decay.js";

const T0 = 1_700_000_000_000; // unix ms, arbitrary
const ONE_HOUR_MS = 3_600_000;

function nearlyEqual(actual: number, expected: number, tol: number, what: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tol,
    `${what}: expected ${expected} ± ${tol}, got ${actual} (diff ${diff})`
  );
}

test("currentPrice: pre-fetch returns base", () => {
  const cfg: DecayConfig = { basePriceUsdc: 1_000_000, lambdaPerHour: 0.01 };
  assert.equal(currentPrice(cfg, 0, T0), 1_000_000);
});

test("currentPrice: at exactly fetched_at returns base", () => {
  const cfg: DecayConfig = { basePriceUsdc: 1_000_000, lambdaPerHour: 0.01 };
  assert.equal(currentPrice(cfg, T0, T0), 1_000_000);
});

test("currentPrice: exponential at λ=0.01/hr, 50hr → ~606_530", () => {
  const cfg: DecayConfig = { basePriceUsdc: 1_000_000, lambdaPerHour: 0.01 };
  nearlyEqual(
    currentPrice(cfg, T0, T0 + 50 * ONE_HOUR_MS),
    606_531,
    2,
    "exp(-0.5) * 1M"
  );
});

test("currentPrice: at large dt floors at 1 micro-USDC", () => {
  const cfg: DecayConfig = { basePriceUsdc: 1_000_000, lambdaPerHour: 1 };
  // After 30hr λ=1 → exp(-30) ≈ 9.4e-14 → ~0 → floor 1.
  assert.equal(currentPrice(cfg, T0, T0 + 30 * ONE_HOUR_MS), 1);
});

test("currentPrice: respects half-life math", () => {
  // λ=ln2 ⇒ half-life = 1hr. After 1hr expect ~500_000.
  const cfg: DecayConfig = {
    basePriceUsdc: 1_000_000,
    lambdaPerHour: Math.LN2,
  };
  nearlyEqual(currentPrice(cfg, T0, T0 + ONE_HOUR_MS), 500_000, 2, "half-life");
});

test("DECAY_PRESETS: all presets use lambdaPerHour > 0", () => {
  for (const [name, cfg] of Object.entries(DECAY_PRESETS)) {
    assert.ok(cfg.lambdaPerHour > 0, `${name} lambda must be positive`);
    assert.ok(cfg.basePriceUsdc > 0, `${name} basePriceUsdc must be positive`);
  }
});

test("DECAY_PRESETS.weather: 1hr ≈ 99% of base", () => {
  const price = currentPrice(DECAY_PRESETS.weather, T0, T0 + ONE_HOUR_MS);
  // 100_000 * exp(-0.01) ≈ 99005
  nearlyEqual(price, 99_005, 5, "weather 1hr decay");
});

test("DECAY_PRESETS.map_imagery: 24hr (1 day) ≈ very small decay", () => {
  const price = currentPrice(
    DECAY_PRESETS.map_imagery,
    T0,
    T0 + 24 * ONE_HOUR_MS
  );
  // 50_000 * exp(-0.0024) ≈ 49880
  nearlyEqual(price, 49_880, 5, "map_imagery 24hr");
});

// ── lambdaToQ16 (Q16.16 encoding) ───────────────────────────────────────

test("lambdaToQ16: 0.01 → 655", () => {
  // 0.01 * 65536 = 655.36 → round → 655
  assert.equal(lambdaToQ16(0.01), 655);
});

test("lambdaToQ16: 0.0667 → 4371", () => {
  // 0.0667 * 65536 = 4371.25 → round → 4371
  assert.equal(lambdaToQ16(0.0667), 4371);
});

test("lambdaToQ16: rejects non-positive λ", () => {
  assert.throws(() => lambdaToQ16(0));
  assert.throws(() => lambdaToQ16(-1));
  assert.throws(() => lambdaToQ16(NaN));
});

test("lambdaToQ16: rejects out-of-range cap", () => {
  // Anchor caps at 65_536_000 (λ=1000/hr). Just above that should throw.
  assert.throws(() => lambdaToQ16(1001));
});

// ── On-chain parity: Math.exp ↔ exp_neg_q16 simulation ──────────────────
// Mirror of state.rs::exp_neg_q16 so the test asserts the deployed contract
// will produce equivalent results to what the off-chain UI displays.

const Q = 65_536;
const LN2_Q = 45_426;
const X_MAX_Q = 21 * Q;

function expNegQ16Sim(xQ: number): number {
  if (xQ >= X_MAX_Q) return 0;
  const k = Math.floor(xQ / LN2_Q);
  const rQ = BigInt(xQ - k * LN2_Q);
  const q = BigInt(Q);
  const c5 = -q / 120n;
  const c4 = q / 24n;
  const c3 = -q / 6n;
  const c2 = q / 2n;
  const c1 = -q;
  const c0 = q;
  let acc = c5;
  acc = (acc * rQ) / q + c4;
  acc = (acc * rQ) / q + c3;
  acc = (acc * rQ) / q + c2;
  acc = (acc * rQ) / q + c1;
  acc = (acc * rQ) / q + c0;
  const expR = acc < 0n ? 0n : acc;
  return Number(expR >> BigInt(k));
}

test("parity: exp_neg_q16(0) === Q", () => {
  assert.equal(expNegQ16Sim(0), Q);
});

test("parity: exp_neg_q16 matches Math.exp on the meaningful range", () => {
  // Two regimes:
  //   x ∈ [0, 5]: dense values, Q16.16 has plenty of LSBs → tight rel tol.
  //   x ∈ (5, 15]: exp(-x) ≲ 1e-3 in Q16.16 (few LSBs left), use absolute
  //                tolerance ±3 LSBs which is the Q16.16 quantization floor.
  for (const x of [0, 0.1, 0.5, Math.LN2, 1, 2, 5]) {
    const xQ = Math.round(x * Q);
    const sim = expNegQ16Sim(xQ);
    const real = Math.exp(-x) * Q;
    const rel = Math.abs(sim - real) / Math.max(real, 1);
    assert.ok(
      rel < 2e-3,
      `exp(-${x}): sim=${sim} real=${real.toFixed(2)} rel=${rel.toExponential(2)}`
    );
  }
  for (const x of [7, 10, 15]) {
    const xQ = Math.round(x * Q);
    const sim = expNegQ16Sim(xQ);
    const real = Math.exp(-x) * Q;
    const absDiff = Math.abs(sim - real);
    assert.ok(
      absDiff <= 3,
      `exp(-${x}) (low-precision regime): sim=${sim} real=${real.toFixed(4)} absDiff=${absDiff}`
    );
  }
});

test("parity: on-chain Q16.16 sim vs off-chain Math.exp price agree within 0.5%", () => {
  // The off-chain currentPrice() uses Math.exp; on-chain uses exp_neg_q16.
  // For each (λ, dt), assert both produce prices within 0.5% of each other.
  // 0.5% includes both the λ→Q16.16 quantization AND polynomial error.
  const grid: Array<{ lam: number; hours: number }> = [
    { lam: 0.01, hours: 1 },
    { lam: 0.01, hours: 10 },
    { lam: 0.01, hours: 50 },
    { lam: 0.0667, hours: 5 },
    { lam: 0.0001, hours: 24 },
    { lam: 0.05, hours: 2 },
  ];
  const base = 1_000_000;
  for (const { lam, hours } of grid) {
    const offChain = Math.max(1, Math.floor(base * Math.exp(-lam * hours)));
    const lambdaQ = lambdaToQ16(lam);
    const xQ = Math.floor(lambdaQ * hours); // λ_q (Q16.16/hr) · hours = x in Q16.16
    const expQ = expNegQ16Sim(xQ);
    const onChain = Math.max(1, Math.floor((base * expQ) / Q));
    const rel = Math.abs(offChain - onChain) / Math.max(offChain, 1);
    assert.ok(
      rel < 5e-3,
      `λ=${lam} hr=${hours}: off=${offChain} on=${onChain} rel=${rel.toExponential(2)}`
    );
  }
});
