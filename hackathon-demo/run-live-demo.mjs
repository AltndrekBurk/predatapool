const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const ENDPOINT =
  process.env.DEMO_ENDPOINT ??
  "https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,wind_speed_10m";

const buyers = [
  "11111111111111111111111111111111",
  "22222222222222222222222222222222",
  "33333333333333333333333333333333",
  "44444444444444444444444444444444",
  "55555555555555555555555555555555",
  "66666666666666666666666666666666",
];

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json();
  return { status: res.status, body };
}

async function waitForFetched(poolHash) {
  for (let i = 0; i < 60; i++) {
    const { body } = await fetchJson(`${SERVER_URL}/pool/${poolHash}`);
    if (body?.status === "fetched") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`pool ${poolHash} did not reach fetched state in time`);
}

async function requestForBuyer(index, buyerPubkey) {
  const { status, body } = await fetchJson(`${SERVER_URL}/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: ENDPOINT,
      method: "GET",
      params: {},
      buyerPubkey,
      dataType: "weather",
      freshnessWindowSecs: 60,
    }),
  });

  const prefix = `[${index + 1}/${buyers.length}] ${buyerPubkey.slice(0, 6)}...`;
  console.log(`${prefix} HTTP ${status}`);
  console.log(
    `${prefix} pool=${body.poolHash.slice(0, 8)}... cacheHit=${body.cacheHit} fetchTriggered=${body.fetchTriggered}`
  );
  console.log(
    `${prefix} price=${body.currentPriceFormatted} expiresAt=${body.expiresAt ?? "n/a"}`
  );
  return body.poolHash;
}

async function main() {
  console.log(`[demo] server=${SERVER_URL}`);
  console.log(`[demo] endpoint=${ENDPOINT}`);
  console.log(`[demo] buyers=${buyers.length}`);
  console.log("");

  const firstPoolHash = await requestForBuyer(0, buyers[0]);
  const secondPoolHash = await requestForBuyer(1, buyers[1]);
  const poolHash = secondPoolHash ?? firstPoolHash;

  console.log("");
  console.log(`[wait] polling ${poolHash.slice(0, 8)}... until fetched`);
  const pool = await waitForFetched(poolHash);
  console.log(
    `[wait] fetched status=${pool.status} buyers=${pool.buyers.length} dataHash=${String(pool.dataHash ?? "").slice(0, 16)}...`
  );
  console.log("");

  for (let i = 2; i < buyers.length; i++) {
    await requestForBuyer(i, buyers[i]);
  }

  const finalPool = await fetchJson(`${SERVER_URL}/pool/${poolHash}`);
  const metadata = await fetchJson(`${SERVER_URL}/pool/${poolHash}/metadata`);
  console.log("");
  console.log(`[summary] requests=${buyers.length}`);
  console.log(
    `[summary] reused=${Math.max(0, buyers.length - 1)} avoided_upstream_fetches`
  );
  console.log(
    `[summary] pool_status=${finalPool.body.status} buyer_count=${finalPool.body.buyers.length}`
  );
  console.log(
    `[summary] payload_url=${metadata.body.payloadUrl ?? "/pool/.../payload"}`
  );
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});

