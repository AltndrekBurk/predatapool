import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { buildDataEnvelopeV0, verifyDataEnvelopeV0 } from "./envelope.js";

test("DataEnvelope v0 verifies with real keeper signature", () => {
  const keeper = Keypair.generate();
  const payload = Buffer.from('{"ok":true}');
  const envelope = buildDataEnvelopeV0({
    payload,
    sourceUrl: "https://api.example.test/v1/public",
    fetchedAt: 1_000,
    expiresAt: Date.now() + 60_000,
    keeper,
  });

  assert.equal(
    verifyDataEnvelopeV0({
      payload,
      envelope,
      keeperPubkey: keeper.publicKey.toBytes(),
    }),
    true
  );
});

test("DataEnvelope v0 rejects tampered payload", () => {
  const keeper = Keypair.generate();
  const envelope = buildDataEnvelopeV0({
    payload: Buffer.from("original"),
    sourceUrl: "https://api.example.test/v1/public",
    fetchedAt: 1_000,
    expiresAt: Date.now() + 60_000,
    keeper,
  });

  assert.equal(
    verifyDataEnvelopeV0({
      payload: Buffer.from("tampered"),
      envelope,
      keeperPubkey: keeper.publicKey.toBytes(),
    }),
    false
  );
});

test("DataEnvelope v0 rejects expired envelope", () => {
  const keeper = Keypair.generate();
  const payload = Buffer.from("original");
  const envelope = buildDataEnvelopeV0({
    payload,
    sourceUrl: "https://api.example.test/v1/public",
    fetchedAt: 1_000,
    expiresAt: 2_000,
    keeper,
  });

  assert.equal(
    verifyDataEnvelopeV0({
      payload,
      envelope,
      keeperPubkey: keeper.publicKey.toBytes(),
      now: 3_000,
    }),
    false
  );
});
