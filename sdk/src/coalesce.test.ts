import test from "node:test";
import assert from "node:assert/strict";
import { Singleflight } from "./coalesce.js";

test("Singleflight: 10 concurrent calls invoke fn once", async () => {
  const sf = new Singleflight<number>();
  let calls = 0;
  let resolveLeader: ((v: number) => void) | undefined;
  const leader = new Promise<number>((r) => {
    resolveLeader = r;
  });
  const fn = async () => {
    calls += 1;
    return leader;
  };

  const awaiters = Array.from({ length: 10 }, () => sf.do("k", fn));
  assert.equal(sf.size, 1, "in-flight Map has exactly one entry");

  resolveLeader!(42);
  const results = await Promise.all(awaiters);
  assert.deepEqual(results, Array.from({ length: 10 }, () => 42));
  assert.equal(calls, 1, "fn invoked exactly once for the coalesced key");
  assert.equal(sf.size, 0, "entry cleared on settle");
});

test("Singleflight: distinct keys do not coalesce", async () => {
  const sf = new Singleflight<string>();
  let aCalls = 0;
  let bCalls = 0;
  const a = sf.do("a", async () => {
    aCalls += 1;
    return "A";
  });
  const b = sf.do("b", async () => {
    bCalls += 1;
    return "B";
  });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, "A");
  assert.equal(rb, "B");
  assert.equal(aCalls, 1);
  assert.equal(bCalls, 1);
});

test("Singleflight: rejection propagates to all awaiters and clears entry", async () => {
  const sf = new Singleflight<number>();
  let calls = 0;
  let rejectLeader: ((e: Error) => void) | undefined;
  const fn = async () => {
    calls += 1;
    return new Promise<number>((_, rej) => {
      rejectLeader = rej;
    });
  };
  const a = sf.do("k", fn);
  const b = sf.do("k", fn);
  assert.equal(sf.size, 1);

  rejectLeader!(new Error("boom"));

  await assert.rejects(a, /boom/);
  await assert.rejects(b, /boom/);
  assert.equal(calls, 1);
  assert.equal(sf.size, 0, "rejected entry cleared (failures never cached)");
});

test("Singleflight: after settle, next call starts a fresh fn invocation", async () => {
  const sf = new Singleflight<number>();
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return calls;
  };
  const r1 = await sf.do("k", fn);
  const r2 = await sf.do("k", fn);
  assert.equal(r1, 1);
  assert.equal(r2, 2);
  assert.equal(calls, 2, "serial retries are independent of coalescing");
});

test("Singleflight: concurrent rejection then concurrent success", async () => {
  const sf = new Singleflight<number>();
  let attempt = 0;
  const fn = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("first attempt fails");
    return 7;
  };
  await assert.rejects(
    Promise.all([sf.do("k", fn), sf.do("k", fn)]),
    /first attempt fails/
  );
  const [a, b] = await Promise.all([sf.do("k", fn), sf.do("k", fn)]);
  assert.equal(a, 7);
  assert.equal(b, 7);
  assert.equal(attempt, 2, "second attempt is independent and succeeds");
});
