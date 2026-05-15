/**
 * Light Protocol client glue for compressed-account CPIs.
 *
 * On the program side (settle_receipt + claim_rebate) we invoke the Light
 * system program via CPI to either (a) create a new compressed BuyerSlot
 * leaf at a deterministic address, or (b) read+update an existing leaf.
 * Both flows need three things from the client:
 *
 *   1. A ValidityProof (zk-SNARK) covering the addresses or hashes touched.
 *   2. PackedAddressTreeInfo / PackedStateTreeInfo — small structs whose
 *      indices reference the corresponding Merkle tree / queue / state-tree
 *      accounts inside the transaction's `remaining_accounts`.
 *   3. The `remaining_accounts` array itself, in the exact order Light's
 *      Rust SDK expects (system accounts first at index 0, then trees).
 *
 * Photon RPC is the canonical zk indexer + prover host. We talk to it via
 * `@lightprotocol/stateless.js` — version-aligned with our Rust `light-sdk
 * 0.23` dependency.
 */
import { PublicKey, AccountMeta } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { BorshTypesCoder } from "@coral-xyz/anchor/dist/cjs/coder/borsh/types.js";
import {
  Rpc,
  createRpc,
  PackedAccounts,
  SystemAccountMetaConfig,
  getDefaultAddressTreeInfo,
  selectStateTreeInfo,
  createCompressedAccountMeta,
  type CompressedAccountMeta,
  type PackedStateTreeInfo,
  deriveAddressSeed,
  deriveAddress,
  bn,
  type AddressWithTree,
  type HashWithTree,
  type ValidityProof,
} from "@lightprotocol/stateless.js";
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);
const IDL = requireFromHere("../../anchor/target/idl/datapool.json");

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D"
);

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/**
 * Get-or-create a singleton Photon-aware Rpc client. Throws if PHOTON_RPC_URL
 * is unset — `settle_receipt` and `claim_rebate` cannot run without one.
 */
let cachedRpc: Rpc | null = null;
export function getLightRpc(): Rpc {
  if (cachedRpc) return cachedRpc;
  const photon = process.env.PHOTON_RPC_URL;
  if (!photon) {
    throw new Error(
      "PHOTON_RPC_URL is required for Light Protocol CPIs. " +
        "Use a Helius / Light Protocol Photon endpoint."
    );
  }
  const prover = process.env.PROVER_URL || photon;
  cachedRpc = createRpc(SOLANA_RPC_URL, photon, prover);
  return cachedRpc;
}

/**
 * Wire form of a ValidityProof matching the Anchor IDL.
 *
 * Rust: `pub struct ValidityProof(pub Option<CompressedProof>);`
 * Anchor TS coder serializes the unnamed tuple field as `_0`; we hand it
 * the literal-key object form `{ "0": ... }` which round-trips correctly.
 */
export type WireValidityProof = {
  0: { a: number[]; b: number[]; c: number[] } | null;
};

export type WirePackedAddressTreeInfo = {
  addressMerkleTreePubkeyIndex: number;
  addressQueuePubkeyIndex: number;
  rootIndex: number;
};

/**
 * Bundle of everything `settle_receipt` needs from the client side.
 *
 * `remainingAccounts` MUST be passed to Anchor verbatim — its layout
 * (system accounts at index 0, then trees) is what our program's
 * `CpiAccounts::new(keeper, ctx.remaining_accounts, …)` expects.
 */
export interface SettleReceiptCpiInputs {
  validityProof: WireValidityProof;
  addressTreeInfo: WirePackedAddressTreeInfo;
  outputTreeIndex: number;
  remainingAccounts: AccountMeta[];
}

/**
 * Mirror of the Rust-side address derivation:
 *   derive_address(&[b"buyer_slot", pool_key, buyer], address_tree, program_id)
 *
 * Same (pool, buyer) pair always yields the same address — Light rejects a
 * second insert at that address, which is our replay protection.
 */
export function deriveBuyerSlotAddress(
  poolPda: PublicKey,
  buyer: PublicKey,
  addressTree: PublicKey
): PublicKey {
  const seed = deriveAddressSeed(
    [Buffer.from("buyer_slot"), poolPda.toBuffer(), buyer.toBuffer()],
    PROGRAM_ID
  );
  return deriveAddress(seed, addressTree, PROGRAM_ID);
}

/**
 * Build the CPI inputs for inserting a fresh BuyerSlot leaf.
 *
 * Steps:
 *   1. Pick the address tree (single default V1 tree on devnet/mainnet).
 *   2. Derive the deterministic buyer-slot address.
 *   3. Pick a state output tree (load-balanced across active V1 trees).
 *   4. Ask Photon for a non-inclusion proof on the new address.
 *   5. Pack system accounts + tree accounts in the order Light expects.
 */
export async function prepareSettleReceiptCpi(params: {
  poolPda: PublicKey;
  buyer: PublicKey;
}): Promise<SettleReceiptCpiInputs> {
  const rpc = getLightRpc();

  const addressTreeInfo = getDefaultAddressTreeInfo();
  const newAddress = deriveBuyerSlotAddress(
    params.poolPda,
    params.buyer,
    addressTreeInfo.tree
  );

  const stateTreeInfos = await rpc.getStateTreeInfos();
  const stateTreeInfo = selectStateTreeInfo(stateTreeInfos);

  const addressWithTree: AddressWithTree = {
    address: bn(newAddress.toBytes()),
    tree: addressTreeInfo.tree,
    queue: addressTreeInfo.queue,
  };

  const proofCtx = await rpc.getValidityProofV0([], [addressWithTree]);

  // Pack: light system accounts first (at index 0..systemAccountsLen),
  // then our tree refs appended via insertOrGet. The returned indices
  // are absolute into `remainingAccounts` — exactly what the Rust
  // `PackedAddressTreeInfo` and `output_tree_index` expect.
  const packed = PackedAccounts.newWithSystemAccounts(
    SystemAccountMetaConfig.new(PROGRAM_ID)
  );
  const addressMerkleTreeIdx = packed.insertOrGet(addressTreeInfo.tree);
  const addressQueueIdx = packed.insertOrGet(addressTreeInfo.queue);
  const stateTreeIdx = packed.insertOrGet(stateTreeInfo.tree);

  const { remainingAccounts } = packed.toAccountMetas();

  return {
    validityProof: { 0: proofCtx.compressedProof },
    addressTreeInfo: {
      addressMerkleTreePubkeyIndex: addressMerkleTreeIdx,
      addressQueuePubkeyIndex: addressQueueIdx,
      rootIndex: proofCtx.rootIndices[0],
    },
    outputTreeIndex: stateTreeIdx,
    remainingAccounts,
  };
}

/**
 * CPI inputs for `claim_rebate`. Mutate-existing-leaf path: fetches the
 * sponsor's compressed BuyerSlot from Photon RPC, builds an INCLUSION
 * validity proof + `CompressedAccountMeta` for the existing leaf, packs
 * the system + tree accounts the program will read via `remaining_accounts`.
 *
 * Caller still has to decode `rawData` into the program-defined
 * `CompressedBuyerSlot` shape (Anchor `program.coder.types.decode("CompressedBuyerSlot", data)`)
 * before passing it to `program.methods.claimRebate(...)` — that decode is
 * kept on the keeper side so this module stays free of the Anchor `Program`
 * coupling.
 */
export interface ClaimRebateCpiInputs {
  validityProof: WireValidityProof;
  slotMeta: CompressedAccountMeta;
  rawData: Buffer;
  remainingAccounts: AccountMeta[];
}

export async function prepareClaimRebateCpi(params: {
  poolPda: PublicKey;
  buyer: PublicKey;
}): Promise<ClaimRebateCpiInputs> {
  const rpc = getLightRpc();

  const addressTreeInfo = getDefaultAddressTreeInfo();
  const slotAddress = deriveBuyerSlotAddress(
    params.poolPda,
    params.buyer,
    addressTreeInfo.tree
  );

  const account = await rpc.getCompressedAccount(bn(slotAddress.toBytes()));
  if (!account) {
    throw new Error(
      `BuyerSlot leaf not found for pool ${params.poolPda
        .toBase58()
        .slice(0, 8)}... buyer ${params.buyer.toBase58().slice(0, 8)}... ` +
        "— sponsor must have settled before they can claim."
    );
  }
  if (!account.data) {
    throw new Error("CompressedAccount has no data — cannot decode BuyerSlot");
  }

  // Inclusion proof on the existing leaf hash.
  const hashWithTree: HashWithTree = {
    hash: account.hash,
    tree: account.treeInfo.tree,
    queue: account.treeInfo.queue,
  };
  const proofCtx = await rpc.getValidityProofV0([hashWithTree], []);

  // Pack accounts: system metas first, then tree refs the program reads.
  const packed = PackedAccounts.newWithSystemAccounts(
    SystemAccountMetaConfig.new(PROGRAM_ID)
  );
  const stateTreeInfo = account.treeInfo;
  const merkleTreeIdx = packed.insertOrGet(stateTreeInfo.tree);
  const queueIdx = packed.insertOrGet(stateTreeInfo.queue);

  // Output tree where the mutated leaf is written. Same active state tree
  // is fine for a same-tree update; load-balance only matters for inserts.
  const outputStateTreeInfos = await rpc.getStateTreeInfos();
  const outputTreeInfo = selectStateTreeInfo(outputStateTreeInfos);
  const outputTreeIdx = packed.insertOrGet(outputTreeInfo.tree);

  const { remainingAccounts } = packed.toAccountMetas();

  const packedTreeInfo: PackedStateTreeInfo = {
    rootIndex: proofCtx.rootIndices[0],
    proveByIndex: false,
    merkleTreePubkeyIndex: merkleTreeIdx,
    queuePubkeyIndex: queueIdx,
    leafIndex: account.leafIndex,
  };

  const slotMeta = createCompressedAccountMeta(
    packedTreeInfo,
    outputTreeIdx,
    Array.from(slotAddress.toBytes())
  );

  return {
    validityProof: { 0: proofCtx.compressedProof },
    slotMeta,
    rawData: account.data.data,
    remainingAccounts,
  };
}
