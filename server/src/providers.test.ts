import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupProvider } from "./providers.js";

test("known hostname resolves to its agreement", () => {
  const a = lookupProvider("https://api.weatherxm.com/v1/cells");
  assert.equal(a.upstream.kind, "apiKey");
  assert.equal(a.freshnessWindowSecs, 60);
});

test("hivemapper resolves with day-long freshness", () => {
  const a = lookupProvider("https://hivemapper-api.com/foo");
  assert.equal(a.freshnessWindowSecs, 86_400);
});

test("localhost:4001 resolves to the mpp mock-upstream agreement", () => {
  const a = lookupProvider("http://localhost:4001/paid-data");
  assert.equal(a.upstream.kind, "mpp");
  if (a.upstream.kind === "mpp") {
    assert.equal(a.upstream.currency, "USDC");
  }
});

test("unknown hostnames fall back to free upstream", () => {
  const a = lookupProvider("https://random.example.org/x");
  assert.equal(a.upstream.kind, "free");
  assert.equal(a.freshnessWindowSecs, 300);
});

test("malformed URLs fall back to default agreement", () => {
  const a = lookupProvider("not a url");
  assert.equal(a.upstream.kind, "free");
});
