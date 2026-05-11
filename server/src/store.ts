/**
 * Persistent pool + payload store.
 *
 * Replaces the in-memory `Map` that the matcher used in v0. Survives restart
 * and exposes a TTL view: an entry whose `expires_at < now` is a stale pool
 * (next request triggers a new fetch + payment to the upstream provider).
 *
 * Backed by `better-sqlite3` (sync, embedded — no external daemon). The
 * Redis-class abstraction lives behind `PoolStore`, so swapping to a
 * networked KV later is one file.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type PoolStatus = "pending" | "fetching" | "fetched" | "closed";

export interface PoolRecord {
  requestHashHex: string;
  endpoint: string;
  params: Record<string, string>;
  providerId: string;
  method: string;
  freshnessWindowSecs: number;
  buyers: string[];
  authorizedBuyers: string[];
  createdAt: number; // unix ms
  fetchedAt?: number;
  dataHash?: string;
  status: PoolStatus;
  minBuyers: number;
  /** unix ms — when set, the cached pool/payload becomes stale at this time. */
  expiresAt?: number;
}

export interface PayloadRecord {
  requestHashHex: string;
  /** AES-256-GCM ciphertext (with appended 16-byte tag). */
  ciphertext: Buffer;
  /** 12-byte AES-GCM IV. */
  iv: Buffer;
  /** 32-byte per-pool symmetric key. Lives server-side only — buyers only see ECIES wraps. */
  poolKey: Buffer;
  /** SHA-256("DATAPOOL_K_V1" || poolKey) — published on-chain in register_dataset. */
  keyCommitment: Buffer;
  envelopeVersion: number;
  sourceUrl: string;
  sourceHash: Buffer;
  merkleRoot: Buffer;
  keeperPubkey: Buffer;
  keeperSignature: Buffer;
  contentType: string;
  fetchedAt: number;
  expiresAt: number;
  paymentSignature?: string;
}

interface PoolRow {
  request_hash_hex: string;
  endpoint: string;
  params_json: string;
  provider_id: string;
  method: string;
  freshness_window_secs: number;
  buyers_json: string;
  authorized_buyers_json: string;
  created_at: number;
  fetched_at: number | null;
  data_hash: string | null;
  status: PoolStatus;
  min_buyers: number;
  expires_at: number | null;
}

interface PayloadRow {
  request_hash_hex: string;
  ciphertext: Buffer;
  iv: Buffer;
  pool_key: Buffer;
  key_commitment: Buffer;
  envelope_version: number;
  source_url: string;
  source_hash: Buffer;
  merkle_root: Buffer;
  keeper_pubkey: Buffer;
  keeper_signature: Buffer;
  content_type: string;
  fetched_at: number;
  expires_at: number;
  payment_signature: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pools (
  request_hash_hex      TEXT PRIMARY KEY,
  endpoint              TEXT NOT NULL,
  params_json           TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  method                TEXT NOT NULL,
  freshness_window_secs INTEGER NOT NULL,
  buyers_json           TEXT NOT NULL,
  authorized_buyers_json TEXT NOT NULL DEFAULT '[]',
  created_at            INTEGER NOT NULL,
  fetched_at            INTEGER,
  data_hash             TEXT,
  status                TEXT NOT NULL,
  min_buyers            INTEGER NOT NULL,
  expires_at            INTEGER
);
CREATE INDEX IF NOT EXISTS pools_expires_at ON pools(expires_at);
CREATE INDEX IF NOT EXISTS pools_status ON pools(status);

CREATE TABLE IF NOT EXISTS payloads (
  request_hash_hex   TEXT PRIMARY KEY,
  ciphertext         BLOB NOT NULL,
  iv                 BLOB NOT NULL,
  pool_key           BLOB NOT NULL,
  key_commitment     BLOB NOT NULL,
  envelope_version   INTEGER NOT NULL,
  source_url         TEXT NOT NULL,
  source_hash        BLOB NOT NULL,
  merkle_root        BLOB NOT NULL,
  keeper_pubkey      BLOB NOT NULL,
  keeper_signature   BLOB NOT NULL,
  content_type       TEXT NOT NULL,
  fetched_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  payment_signature  TEXT,
  FOREIGN KEY (request_hash_hex) REFERENCES pools(request_hash_hex) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS payloads_expires_at ON payloads(expires_at);
`;

/**
 * Schema version. Bump whenever a column shape changes — the constructor
 * drops & recreates tables on mismatch (cache is rebuilt naturally on next
 * fetch, no migration step needed because everything off-chain is replaceable).
 */
const SCHEMA_VERSION = 5;

function rowToPool(r: PoolRow): PoolRecord {
  return {
    requestHashHex: r.request_hash_hex,
    endpoint: r.endpoint,
    params: JSON.parse(r.params_json),
    providerId: r.provider_id,
    method: r.method,
    freshnessWindowSecs: r.freshness_window_secs,
    buyers: JSON.parse(r.buyers_json),
    authorizedBuyers: JSON.parse(r.authorized_buyers_json),
    createdAt: r.created_at,
    fetchedAt: r.fetched_at ?? undefined,
    dataHash: r.data_hash ?? undefined,
    status: r.status,
    minBuyers: r.min_buyers,
    expiresAt: r.expires_at ?? undefined,
  };
}

function rowToPayload(r: PayloadRow): PayloadRecord {
  return {
    requestHashHex: r.request_hash_hex,
    ciphertext: r.ciphertext,
    iv: r.iv,
    poolKey: r.pool_key,
    keyCommitment: r.key_commitment,
    envelopeVersion: r.envelope_version,
    sourceUrl: r.source_url,
    sourceHash: r.source_hash,
    merkleRoot: r.merkle_root,
    keeperPubkey: r.keeper_pubkey,
    keeperSignature: r.keeper_signature,
    contentType: r.content_type,
    fetchedAt: r.fetched_at,
    expiresAt: r.expires_at,
    paymentSignature: r.payment_signature ?? undefined,
  };
}

export class PoolStore {
  private db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrateIfNeeded();
    this.db.exec(SCHEMA);
  }

  /**
   * On schema-version mismatch, drop the old payloads + pools tables.
   * Off-chain cache is rebuilt naturally on next fetch — every entry is
   * replaceable from the upstream — so a hard reset is safer than a
   * column-shape migration that risks silent type mismatches.
   */
  private migrateIfNeeded(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)"
    );
    const row = this.db
      .prepare("SELECT version FROM schema_meta LIMIT 1")
      .get() as { version: number } | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO schema_meta(version) VALUES (?)")
        .run(SCHEMA_VERSION);
      return;
    }
    if (row.version !== SCHEMA_VERSION) {
      this.db.exec("DROP TABLE IF EXISTS payloads");
      this.db.exec("DROP TABLE IF EXISTS pools");
      this.db
        .prepare("UPDATE schema_meta SET version = ?")
        .run(SCHEMA_VERSION);
    }
  }

  getPool(hashHex: string): PoolRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM pools WHERE request_hash_hex = ?")
      .get(hashHex) as PoolRow | undefined;
    return row ? rowToPool(row) : undefined;
  }

  insertPool(p: PoolRecord): void {
    this.db
      .prepare(
        `INSERT INTO pools (
          request_hash_hex, endpoint, params_json, provider_id, method,
          freshness_window_secs, buyers_json, authorized_buyers_json, created_at, fetched_at,
          data_hash, status, min_buyers, expires_at
        ) VALUES (
          @request_hash_hex, @endpoint, @params_json, @provider_id, @method,
          @freshness_window_secs, @buyers_json, @authorized_buyers_json, @created_at, @fetched_at,
          @data_hash, @status, @min_buyers, @expires_at
        )`
      )
      .run({
        request_hash_hex: p.requestHashHex,
        endpoint: p.endpoint,
        params_json: JSON.stringify(p.params),
        provider_id: p.providerId,
        method: p.method,
        freshness_window_secs: p.freshnessWindowSecs,
        buyers_json: JSON.stringify(p.buyers),
        authorized_buyers_json: JSON.stringify(p.authorizedBuyers),
        created_at: p.createdAt,
        fetched_at: p.fetchedAt ?? null,
        data_hash: p.dataHash ?? null,
        status: p.status,
        min_buyers: p.minBuyers,
        expires_at: p.expiresAt ?? null,
      });
  }

  /**
   * INSERT … ON CONFLICT REPLACE — used when a request comes in for an
   * already-stale pool: we overwrite the row with a fresh one keyed by the
   * same hash. CASCADE drops the old payload along with it.
   */
  upsertPool(p: PoolRecord): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM pools WHERE request_hash_hex = ?").run(
        p.requestHashHex
      );
      this.insertPool(p);
    });
    tx();
  }

  setStatus(hashHex: string, status: PoolStatus): void {
    this.db
      .prepare("UPDATE pools SET status = ? WHERE request_hash_hex = ?")
      .run(status, hashHex);
  }

  /**
   * Append `buyer` to a pool's buyers list if not already present.
   * Returns true when newly added, false on duplicate / missing pool.
   */
  addBuyer(hashHex: string, buyer: string): boolean {
    const row = this.db
      .prepare("SELECT buyers_json FROM pools WHERE request_hash_hex = ?")
      .get(hashHex) as { buyers_json: string } | undefined;
    if (!row) return false;
    const buyers: string[] = JSON.parse(row.buyers_json);
    if (buyers.includes(buyer)) return false;
    buyers.push(buyer);
    this.db
      .prepare("UPDATE pools SET buyers_json = ? WHERE request_hash_hex = ?")
      .run(JSON.stringify(buyers), hashHex);
    return true;
  }

  addAuthorizedBuyer(hashHex: string, buyer: string): boolean {
    const row = this.db
      .prepare("SELECT authorized_buyers_json FROM pools WHERE request_hash_hex = ?")
      .get(hashHex) as { authorized_buyers_json: string } | undefined;
    if (!row) return false;
    const buyers: string[] = JSON.parse(row.authorized_buyers_json);
    if (buyers.includes(buyer)) return false;
    buyers.push(buyer);
    this.db
      .prepare(
        "UPDATE pools SET authorized_buyers_json = ? WHERE request_hash_hex = ?"
      )
      .run(JSON.stringify(buyers), hashHex);
    return true;
  }

  recordFetched(
    hashHex: string,
    dataHash: string,
    fetchedAt: number,
    expiresAt: number
  ): void {
    this.db
      .prepare(
        `UPDATE pools SET status='fetched', fetched_at=?, data_hash=?, expires_at=?
         WHERE request_hash_hex = ?`
      )
      .run(fetchedAt, dataHash, expiresAt, hashHex);
  }

  listPools(): PoolRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM pools ORDER BY created_at DESC")
      .all() as PoolRow[];
    return rows.map(rowToPool);
  }

  getPayload(hashHex: string): PayloadRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM payloads WHERE request_hash_hex = ?")
      .get(hashHex) as PayloadRow | undefined;
    return row ? rowToPayload(row) : undefined;
  }

  putPayload(p: PayloadRecord): void {
    this.db
      .prepare(
        `INSERT INTO payloads (
          request_hash_hex, ciphertext, iv, pool_key, key_commitment,
          envelope_version, source_url, source_hash, merkle_root, keeper_pubkey, keeper_signature,
          content_type, fetched_at, expires_at, payment_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_hash_hex) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          iv = excluded.iv,
          pool_key = excluded.pool_key,
          key_commitment = excluded.key_commitment,
          envelope_version = excluded.envelope_version,
          source_url = excluded.source_url,
          source_hash = excluded.source_hash,
          merkle_root = excluded.merkle_root,
          keeper_pubkey = excluded.keeper_pubkey,
          keeper_signature = excluded.keeper_signature,
          content_type = excluded.content_type,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          payment_signature = excluded.payment_signature`
      )
      .run(
        p.requestHashHex,
        p.ciphertext,
        p.iv,
        p.poolKey,
        p.keyCommitment,
        p.envelopeVersion,
        p.sourceUrl,
        p.sourceHash,
        p.merkleRoot,
        p.keeperPubkey,
        p.keeperSignature,
        p.contentType,
        p.fetchedAt,
        p.expiresAt,
        p.paymentSignature ?? null
      );
  }

  /**
   * Drop pools and payloads whose expires_at is set and in the past.
   * Pools without expires_at (still pending / fetching) are kept.
   */
  prune(now: number): { pools: number; payloads: number } {
    const tx = this.db.transaction(() => {
      const payloadResult = this.db
        .prepare("DELETE FROM payloads WHERE expires_at < ?")
        .run(now);
      const poolResult = this.db
        .prepare(
          "DELETE FROM pools WHERE expires_at IS NOT NULL AND expires_at < ?"
        )
        .run(now);
      return { pools: poolResult.changes, payloads: payloadResult.changes };
    });
    return tx();
  }

  close(): void {
    this.db.close();
  }
}

let cachedStore: PoolStore | undefined;

export function getStore(): PoolStore {
  if (!cachedStore) {
    const path = process.env.DATAPOOL_STORE_PATH ?? "cache/datapool.db";
    cachedStore = new PoolStore(path);
  }
  return cachedStore;
}

/** Test seam — replace the singleton with an explicit instance. */
export function _setStoreForTests(store: PoolStore | undefined): void {
  cachedStore?.close();
  cachedStore = store;
}
