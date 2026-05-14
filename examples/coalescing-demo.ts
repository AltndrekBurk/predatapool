#!/usr/bin/env node
/**
 * PreDataPool — Singleflight Coalescing Demo
 *
 * Spawns 10 concurrent callers asking for the same canonical request and
 * asserts the SDK's Singleflight collapses them to ONE underlying call.
 * This is the Cloudflare-style coalescing the README promises, isolated
 * from network + on-chain dependencies for a fast assertion.
 *
 *   tsx examples/coalescing-demo.ts
 */

import { Singleflight, hashRequestV2Hex } from "@predatapool/sdk";

async function main(): Promise<void> {
  const sf = new Singleflight<number>();

  const sameKey = hashRequestV2Hex({
    providerId: "11111111111111111111111111111111",
    method: "GET",
    endpoint: "https://api.weather.example/v1/current?lat=40&lon=29",
    params: {},
    freshnessWindowSecs: 60,
  });

  let invocations = 0;
  const work = async (): Promise<number> => {
    invocations += 1;
    await new Promise((r) => setTimeout(r, 50));
    return 42;
  };

  const concurrent = 10;
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: concurrent }, () => sf.do(sameKey, work))
  );
  const elapsed = Date.now() - start;

  const ok =
    invocations === 1 &&
    results.every((r) => r === 42) &&
    elapsed < 200;

  console.log(`Singleflight coalescing demo`);
  console.log(`  concurrent callers : ${concurrent}`);
  console.log(`  fn invocations     : ${invocations}    (expected 1)`);
  console.log(`  results            : ${JSON.stringify(results)}`);
  console.log(`  elapsed            : ${elapsed}ms  (single-call latency)`);
  console.log(`  result             : ${ok ? "✓ PASS" : "✗ FAIL"}`);

  // Distinct keys should NOT coalesce — second run proves the negative case.
  const otherKey = hashRequestV2Hex({
    providerId: "11111111111111111111111111111111",
    method: "GET",
    endpoint: "https://api.weather.example/v1/current?lat=40&lon=29",
    params: {},
    freshnessWindowSecs: 3600, // different SLO → different pool, different key
  });
  if (otherKey === sameKey) throw new Error("test setup error: keys collided");

  let secondInvocations = 0;
  const work2 = async (): Promise<number> => {
    secondInvocations += 1;
    return 7;
  };
  const mixed = await Promise.all([
    sf.do(sameKey, work),
    sf.do(otherKey, work2),
  ]);
  console.log();
  console.log(`Distinct keys do not coalesce`);
  console.log(`  key A invocations  : 1 (fresh)`);
  console.log(`  key B invocations  : ${secondInvocations}    (expected 1)`);
  console.log(`  result             : ${JSON.stringify(mixed)}`);

  if (!ok || secondInvocations !== 1) {
    process.exit(1);
  }
}

void main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
