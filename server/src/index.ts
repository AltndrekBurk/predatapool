import express from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import {
  joinPool,
  markFetching,
  markFetched,
  getPool,
  getAllPools,
  buildPoolMetadata,
} from "./matcher.js";
import { getStore } from "./store.js";
import { fetchData } from "./fetcher.js";
import { currentPrice, DECAY_PRESETS } from "./decay.js";
import {
  triggerFetchOnChain,
  registerDatasetOnChain,
  initializePoolOnChain,
  loadKeeper,
  loadKeeperKitSigner,
  getKeeperRpcUrl,
} from "./keeper.js";
import { lookupProvider } from "./providers.js";
import type { KeyPairSigner } from "@solana/kit";
import {
  acceptReceipt,
  getPendingBatch,
  listPoolsWithPending,
  ReceiptError,
} from "./batch.js";
import type { JoinReceipt } from "./receipt.js";
import {
  encryptPayload,
  keyCommitment as deriveKeyCommitment,
  newPoolKey,
  wrapPoolKey,
  WRAPPED_KEY_BYTES,
  X25519_KEY_BYTES,
} from "./crypto.js";
import { buildDataEnvelopeV0 } from "./envelope.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  PRUNE_INTERVAL_MS,
  SETTLE_INTERVAL_MS,
  startScheduler,
} from "./scheduler.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

/**
 * Public-facing base URL the server publishes on-chain in `register_dataset`.
 * Buyers read it from the chain and pull `${baseUrl}/pool/<hash>/payload`.
 * Override with SERVER_BASE_URL when running behind a reverse proxy / domain.
 */
const SERVER_BASE_URL =
  process.env.SERVER_BASE_URL ?? `http://localhost:${PORT}`;

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // Devnet USDC
);

/** Cap on the on-chain `storage_uri` String — must match `DataPool::STORAGE_URI_MAX_LEN`. */
const STORAGE_URI_MAX_LEN = 128;

const SENSITIVE_PARAM_RE =
  /(auth|token|secret|password|cookie|session|bearer|private|user|account|wallet|address)/i;

function assertPublicPoolEligible(input: {
  endpoint: string;
  params: Record<string, string>;
}): void {
  const url = new URL(input.endpoint);
  if (url.username || url.password) {
    throw new Error("Endpoint userinfo is not pool-eligible public data");
  }
  for (const key of [...url.searchParams.keys(), ...Object.keys(input.params)]) {
    if (SENSITIVE_PARAM_RE.test(key)) {
      throw new Error(`Param "${key}" looks user-specific or secret; use opt-out/private flow`);
    }
  }
}

/**
 * Boot-time env validation — fail fast instead of crashing 30 seconds in
 * when the keeper tries to call into a missing dependency.
 */
function validateEnv(): void {
  if (process.env.NODE_ENV === "test") return;
  if (!process.env.SERVER_BASE_URL) {
    console.warn(
      "[server] SERVER_BASE_URL not set — on-chain storage_uri will point at " +
        "localhost. Set it before running outside dev."
    );
  }
  if (!process.env.PHOTON_RPC_URL) {
    console.warn(
      "[server] PHOTON_RPC_URL not set — settle_receipt will fail at runtime " +
        "(Light Protocol requires Photon). Set a Helius/Photon endpoint to " +
        "settle compressed BuyerSlot leaves."
    );
  }
}
validateEnv();

/**
 * One in-flight fetch task per canonical pool hash. Guards against two
 * concurrent /request callers both crossing `shouldTriggerFetch=true` and
 * racing to initialize + fetch the same pool. Cleared in `finally`.
 */
const inFlightFetches = new Map<string, Promise<void>>();

/**
 * Lazy-loaded keeper signer for MPP payments. Loaded on first use so the
 * server can boot even if the keeper keypair is missing — only fetches
 * against MPP-charging upstreams will fail until it's wired up.
 */
let cachedMppSigner: KeyPairSigner | undefined;
async function getMppSigner(): Promise<KeyPairSigner> {
  if (!cachedMppSigner) {
    cachedMppSigner = await loadKeeperKitSigner();
  }
  return cachedMppSigner;
}

app.use(cors());
app.use(express.json());

/**
 * Lazy fetch pipeline for a single pool. Runs in the background once the
 * matcher has confirmed the off-chain threshold is met. On-chain
 * `initialize_pool` is deferred to this moment — pools that never cross
 * threshold never burn rent.
 *
 *   1. initialize_pool          ← lazy
 *   2. fetch upstream            (free / API key / MPP)
 *   3. encrypt + envelope        (K_pool stored server-side)
 *   4. trigger_fetch             (writes data_hash on-chain; no threshold check)
 *   5. register_dataset          (publishes storage_uri + key_commitment)
 *   6. markFetched off-chain     (status flips, buyers can poll → sign receipts)
 *
 * The receipt-settlement scheduler (scheduler.ts) handles step 7 — draining
 * signed receipts → settle_receipt → addAuthorizedBuyer. That's the gate
 * the `/pool/:hash/key` endpoint checks.
 */
async function runFetchPipeline(args: {
  poolHashHex: string;
  endpoint: string;
  params: Record<string, string>;
  agreement: ReturnType<typeof lookupProvider>;
}): Promise<void> {
  const { poolHashHex, endpoint, params, agreement } = args;
  try {
    // 1) lazy on-chain initialize
    try {
      await initializePoolOnChain({
        requestHashHex: poolHashHex,
        basePriceUsdc: agreement.basePriceUsdc,
        minBuyers: agreement.minBuyers,
        decayBpsPerHour: agreement.buyerDecayBpsPerHour,
        provider: agreement.provider,
        providerShareBps: agreement.providerShareBps,
        providerDecayBpsPerHour: agreement.providerDecayBpsPerHour,
        usdcMint: USDC_MINT,
      });
    } catch (err) {
      // Pool may already exist from a prior session — log and continue. The
      // subsequent trigger_fetch will fail loudly if the pool truly doesn't
      // exist.
      console.error(
        `[pipeline] initialize_pool for ${poolHashHex.slice(0, 8)}...:`,
        (err as Error).message
      );
    }

    // 2) fetch upstream
    markFetching(poolHashHex);
    const fetchOptions = {
      upstream: agreement.upstream,
      rpcUrl: getKeeperRpcUrl(),
      mppSigner:
        agreement.upstream.kind === "mpp" ? await getMppSigner() : undefined,
    };
    const result = await fetchData(endpoint, params, fetchOptions);
    const dataHashHex = result.dataHash.toString("hex");

    // 3) encrypt + envelope + store
    const fetchedAt = Date.now();
    const expiresAt = fetchedAt + agreement.freshnessWindowSecs * 1000;
    const plaintext = result.rawBody;
    const k = newPoolKey();
    const enc = encryptPayload(k, plaintext);
    const registerKeyCommitment = Buffer.from(deriveKeyCommitment(k));
    const envelope = buildDataEnvelopeV0({
      payload: plaintext,
      sourceUrl: result.source,
      fetchedAt,
      expiresAt,
      keeper: loadKeeper(),
    });
    getStore().putPayload({
      requestHashHex: poolHashHex,
      ciphertext: Buffer.from(enc.ciphertext),
      iv: Buffer.from(enc.iv),
      poolKey: Buffer.from(k),
      keyCommitment: registerKeyCommitment,
      envelopeVersion: envelope.version,
      sourceUrl: envelope.sourceUrl,
      sourceHash: envelope.sourceHash,
      merkleRoot: envelope.merkleRoot,
      keeperPubkey: envelope.keeperPubkey,
      keeperSignature: envelope.keeperSignature,
      contentType: result.contentType || "application/octet-stream",
      fetchedAt,
      expiresAt,
      paymentSignature: result.paymentSignature,
    });

    // 4) trigger_fetch (records data_hash; off-chain threshold already checked)
    const storageUri = `${SERVER_BASE_URL}/pool/${poolHashHex}/payload`;
    if (storageUri.length > STORAGE_URI_MAX_LEN) {
      throw new Error(
        `storage_uri ${storageUri.length} > ${STORAGE_URI_MAX_LEN} bytes — ` +
          "shorten SERVER_BASE_URL"
      );
    }
    await triggerFetchOnChain(poolHashHex, dataHashHex);

    // 5) register_dataset
    await registerDatasetOnChain(poolHashHex, storageUri, registerKeyCommitment, {
      sourceHash: envelope.sourceHash,
      expiresAt,
      merkleRoot: envelope.merkleRoot,
      keeperSignature: envelope.keeperSignature,
    });

    // 6) flip off-chain status — buyers can now poll metadata + sign receipts
    markFetched(poolHashHex, dataHashHex);

    console.log(
      `[pipeline] Pool ${poolHashHex.slice(0, 8)}... fetched + registered. ` +
        `Data hash: ${dataHashHex.slice(0, 16)}...`
    );
  } catch (err) {
    console.error(`[pipeline] Fetch failed for ${poolHashHex.slice(0, 8)}:`, err);
  }
}

app.post("/request", async (req, res) => {
  try {
    const body = req.body as {
      endpoint: string;
      method?: string;
      params?: Record<string, string>;
      buyerPubkey: string;
      dataType?: keyof typeof DECAY_PRESETS;
      /** Buyer-declared freshness SLO in seconds; defaults to provider's. */
      freshnessWindowSecs?: number;
    };

    const earlyAgreement = lookupProvider(body.endpoint);
    assertPublicPoolEligible({
      endpoint: body.endpoint,
      params: body.params ?? {},
    });
    const { pool, shouldTriggerFetch, isNewPool, cacheHit } = joinPool({
      endpoint: body.endpoint,
      method: body.method ?? "GET",
      params: body.params ?? {},
      buyerPubkey: body.buyerPubkey,
      maxPriceUsdc: 1_000_000,
      minBuyers: earlyAgreement.minBuyers,
      providerId: earlyAgreement.provider.toBase58(),
      freshnessWindowSecs:
        body.freshnessWindowSecs ?? earlyAgreement.freshnessWindowSecs,
    });

    // Lazy on-chain initialize + fetch flow runs only when threshold is met.
    // Two concurrent /request callers can both observe shouldTriggerFetch=true
    // for the same pool — `inFlightFetches` dedups them.
    if (shouldTriggerFetch && !inFlightFetches.has(pool.requestHashHex)) {
      const agreement = earlyAgreement;
      const task = runFetchPipeline({
        poolHashHex: pool.requestHashHex,
        endpoint: body.endpoint,
        params: body.params ?? {},
        agreement,
      }).finally(() => inFlightFetches.delete(pool.requestHashHex));
      inFlightFetches.set(pool.requestHashHex, task);
    }

    const preset = DECAY_PRESETS[body.dataType ?? "api_response"];
    const priceNow = currentPrice(preset, pool.fetchedAt ?? 0);

    res.status(200).json({
      poolHash: pool.requestHashHex,
      status: pool.status,
      buyerCount: pool.buyers.length,
      isNewPool,
      fetchTriggered: shouldTriggerFetch,
      cacheHit,
      payloadUrl: pool.status === "fetched" ? `/pool/${pool.requestHashHex}/payload` : undefined,
      dataHash: pool.dataHash,
      expiresAt: pool.expiresAt,
      currentPriceUsdc: priceNow,
      currentPriceFormatted: `$${(priceNow / 1_000_000).toFixed(6)}`,
    });
  } catch (err) {
    console.error("[server] Error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/pool/:hash", (req, res) => {
  const pool = getPool(req.params.hash);

  if (!pool) {
    res.status(404).json({ error: "Pool not found" });
    return;
  }

  res.status(200).json(pool);
});

/**
 * Read-side SDK contract — single endpoint with everything a client needs
 * to verify and consume a request. Shape pinned by `buildPoolMetadata`
 * (matcher.ts); bumping field names requires a version bump there.
 */
app.get("/pool/:hash/metadata", (req, res) => {
  const pool = getPool(req.params.hash);
  if (!pool) {
    res.status(404).json({ error: "Pool not found" });
    return;
  }
  const payload = getStore().getPayload(req.params.hash);
  res.status(200).json(buildPoolMetadata(pool, payload, SERVER_BASE_URL));
});

/**
 * Serve the encrypted payload. Buyer pulls ciphertext + IV via headers,
 * obtains K_pool from POST /pool/:hash/key (gated by signed attestation),
 * decrypts locally with AES-256-GCM, and asserts SHA-256(plaintext) ==
 * on-chain data_hash before signing a settle receipt.
 *
 * Ciphertext is public — without the wrapped K_pool a leaker only gets
 * encrypted bytes. The only path to plaintext is via the key endpoint.
 */
app.get("/pool/:hash/payload", (req, res) => {
  const payload = getStore().getPayload(req.params.hash);
  if (!payload) {
    res.status(404).json({ error: "Payload not cached or expired" });
    return;
  }
  if (payload.expiresAt < Date.now()) {
    res.status(410).json({ error: "Payload expired" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-DataPool-Plaintext-Type", payload.contentType);
  res.setHeader("X-DataPool-IV", payload.iv.toString("hex"));
  res.setHeader(
    "X-DataPool-Key-Commitment",
    payload.keyCommitment.toString("hex")
  );
  res.setHeader("X-DataPool-Fetched-At", String(payload.fetchedAt));
  res.setHeader("X-DataPool-Expires-At", String(payload.expiresAt));
  res.setHeader("X-DataPool-Envelope-Version", String(payload.envelopeVersion));
  res.setHeader("X-DataPool-Source-Url", payload.sourceUrl);
  res.setHeader("X-DataPool-Source-Hash", payload.sourceHash.toString("hex"));
  res.setHeader("X-DataPool-Merkle-Root", payload.merkleRoot.toString("hex"));
  res.setHeader("X-DataPool-Keeper-Pubkey", payload.keeperPubkey.toString("hex"));
  res.setHeader(
    "X-DataPool-Keeper-Signature",
    payload.keeperSignature.toString("hex")
  );
  if (payload.paymentSignature) {
    res.setHeader("X-DataPool-Payment-Signature", payload.paymentSignature);
  }
  res.status(200).send(payload.ciphertext);
});

/**
 * ECIES key delivery. Buyer proves pool membership with an ed25519
 * signature over a canonical request, server wraps K_pool to the buyer's
 * x25519 pubkey, returns wrapped (80 bytes hex).
 *
 * Canonical request body:
 *   buyer:        base58 wallet pubkey
 *   encPubkey:    32-byte hex x25519 pubkey
 *   nonce:        unix-ms-ish, prevents replay (server tracks recent nonces)
 *   signature:    64-byte hex ed25519 sig over keyReqMessage(...)
 *
 * Signed message (deterministic):
 *   "DATAPOOL_KEYREQ_V1" || pool_hash (32B) || encPubkey (32B) || nonce (8B BE)
 *
 * Authorization check: buyer must have submitted a valid signed receipt.
 * (After Photon integration this should also check the on-chain
 * compressed BuyerSlot — currently TODO.)
 */
const KEY_REQ_DOMAIN = "DATAPOOL_KEYREQ_V1";
const KEY_REQ_DOMAIN_BYTES = new TextEncoder().encode(KEY_REQ_DOMAIN);
const KEY_REQ_MESSAGE_BYTES = KEY_REQ_DOMAIN_BYTES.length + 32 + 32 + 8;

/** Per-(buyer, pool) recently-seen nonces — replay protection on the server. */
const seenKeyReqNonces = new Map<string, Set<string>>();

function keyReqMessage(
  poolHashHex: string,
  encPubHex: string,
  nonce: string
): Uint8Array {
  const out = new Uint8Array(KEY_REQ_MESSAGE_BYTES);
  out.set(KEY_REQ_DOMAIN_BYTES, 0);
  out.set(Buffer.from(poolHashHex, "hex"), KEY_REQ_DOMAIN_BYTES.length);
  out.set(
    Buffer.from(encPubHex, "hex"),
    KEY_REQ_DOMAIN_BYTES.length + 32
  );
  // nonce as 8-byte big-endian
  const nb = BigInt(nonce);
  for (let i = 0; i < 8; i++) {
    out[KEY_REQ_DOMAIN_BYTES.length + 64 + i] = Number(
      (nb >> BigInt((7 - i) * 8)) & 0xffn
    );
  }
  return out;
}

app.post("/pool/:hash/key", (req, res) => {
  try {
    const body = req.body as {
      buyer: string;
      encPubkey: string;
      nonce: string;
      signature: string;
    };
    const poolHashHex = req.params.hash;
    const pool = getPool(poolHashHex);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const payload = getStore().getPayload(poolHashHex);
    if (!payload) {
      res.status(404).json({ error: "Payload not cached or expired" });
      return;
    }
    if (payload.expiresAt < Date.now()) {
      res.status(410).json({ error: "Payload expired" });
      return;
    }
    if (!pool.authorizedBuyers.includes(body.buyer)) {
      res.status(403).json({ error: "Buyer has not submitted a valid receipt" });
      return;
    }
    const encPubBytes = Buffer.from(body.encPubkey, "hex");
    if (encPubBytes.length !== X25519_KEY_BYTES) {
      res.status(400).json({ error: "encPubkey must be 32 bytes hex" });
      return;
    }
    const sig = Buffer.from(body.signature, "hex");
    if (sig.length !== 64) {
      res.status(400).json({ error: "signature must be 64 bytes hex" });
      return;
    }
    const buyerEd25519 = new PublicKey(body.buyer).toBytes();
    const msg = keyReqMessage(poolHashHex, body.encPubkey, body.nonce);
    if (!ed25519.verify(sig, msg, buyerEd25519)) {
      res.status(403).json({ error: "Invalid signature" });
      return;
    }
    // Replay protection: per-(buyer, pool) nonce-set.
    const nkey = `${poolHashHex}:${body.buyer}`;
    let seen = seenKeyReqNonces.get(nkey);
    if (!seen) {
      seen = new Set();
      seenKeyReqNonces.set(nkey, seen);
    }
    if (seen.has(body.nonce)) {
      res.status(409).json({ error: "Nonce already used" });
      return;
    }
    seen.add(body.nonce);

    const wrapped = wrapPoolKey(payload.poolKey, encPubBytes);
    res.status(200).json({
      wrappedKey: Buffer.from(wrapped).toString("hex"),
      wrappedKeyBytes: WRAPPED_KEY_BYTES,
      keyCommitment: payload.keyCommitment.toString("hex"),
    });
  } catch (err) {
    console.error("[server] /key error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/pools", (_req, res) => {
  const allPools = getAllPools();
  res.status(200).json({
    pools: allPools,
    count: allPools.length,
  });
});

/**
 * Off-chain receipt submission. Buyer signs a 104-byte canonical
 * JoinReceipt with their wallet, posts it here. Server validates the
 * Ed25519 signature, freshness, and replay-safety, then queues for the
 * next batch settlement. No on-chain tx is sent at this point.
 */
app.post("/receipt", (req, res) => {
  try {
    const body = req.body as {
      poolHash: string; // 32-byte hex
      buyer: string; // base58
      maxPrice: string; // u64 decimal
      nonce: string; // u64 decimal
      deadline: string; // i64 decimal (unix seconds)
      signedMessage: string; // hex
      signature: string; // 64-byte hex
    };

    const poolHash = Buffer.from(body.poolHash, "hex");
    if (poolHash.length !== 32) {
      res.status(400).json({ error: "poolHash must be 32 bytes hex" });
      return;
    }

    const receipt: JoinReceipt = {
      poolHash: new Uint8Array(poolHash),
      buyer: new PublicKey(body.buyer),
      maxPrice: BigInt(body.maxPrice),
      nonce: BigInt(body.nonce),
      deadline: BigInt(body.deadline),
    };

    const result = acceptReceipt({
      receipt,
      signedMessage: new Uint8Array(Buffer.from(body.signedMessage, "hex")),
      signature: new Uint8Array(Buffer.from(body.signature, "hex")),
    });
    // Authorization is granted by the scheduler AFTER settle_receipt
    // succeeds on-chain (see scheduler.tickSettle). A buyer who only posts
    // a signed receipt cannot get K_pool from /pool/:hash/key until their
    // BuyerSlot is committed on-chain.

    res.status(200).json({
      ok: true,
      poolHash: result.poolHashHex,
      batchSize: result.batchSize,
      reused: result.reused,
    });
  } catch (err) {
    if (err instanceof ReceiptError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[server] /receipt error:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Inspect the pending batch for a pool. Read-only debug surface; the
 * scheduler is what actually drains and settles it.
 */
app.get("/pool/:hash/batch", (req, res) => {
  const batch = getPendingBatch(req.params.hash);
  res.status(200).json({
    poolHash: req.params.hash,
    pending: batch.length,
    receipts: batch.map((r) => ({
      buyer: r.receipt.buyer.toBase58(),
      maxPrice: r.receipt.maxPrice.toString(),
      nonce: r.receipt.nonce.toString(),
      deadline: r.receipt.deadline.toString(),
      receivedAt: r.receivedAt,
    })),
  });
});

app.get("/batches", (_req, res) => {
  const pools = listPoolsWithPending();
  res.status(200).json({
    pools,
    totalPending: pools.reduce(
      (sum, p) => sum + getPendingBatch(p).length,
      0
    ),
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    version: "0.1.0",
  });
});

app.listen(PORT, () => {
  startScheduler();
  console.log(`DataPool matching server running on http://localhost:${PORT}`);
  console.log(`  POST /request               — submit a data request`);
  console.log(`  POST /receipt               — submit a signed JoinReceipt`);
  console.log(`  GET  /pool/:hash/metadata   — typed read-side metadata`);
  console.log(`  GET  /pool/:hash/payload    — pull cached payload bytes`);
  console.log(`  GET  /pools                 — list all pools`);
  console.log(`  GET  /batches               — pools with pending receipts`);
  console.log(`  GET  /health                — health check`);
  console.log(`  Settlement tick: every ${SETTLE_INTERVAL_MS}ms`);
  console.log(`  Prune tick:      every ${PRUNE_INTERVAL_MS}ms`);
});
