/**
 * On-chain DataPool program constants and PDA derivations for the frontend.
 * Mirrors server/src/keeper.ts but in @solana/kit form.
 */

import { type Address, address, getProgramDerivedAddress } from "@solana/kit";

export const PROGRAM_ID = address(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D"
);

export const USDC_MINT = address(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

const TEXT = new TextEncoder();

/**
 * Universal delegate PDA — buyers approve this address as a token delegate
 * once with a spending cap; settle_receipt uses it across every pool.
 */
export async function findProtocolDelegatePda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [TEXT.encode("protocol_delegate")],
  });
  return pda;
}

/**
 * Pool PDA — `["data_pool", request_hash]`.
 */
export async function findPoolPda(requestHash: Uint8Array): Promise<Address> {
  if (requestHash.length !== 32) {
    throw new Error(`request_hash must be 32 bytes, got ${requestHash.length}`);
  }
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [TEXT.encode("data_pool"), requestHash],
  });
  return pda;
}
