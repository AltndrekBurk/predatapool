import { type Address } from 'ox';
import type { Account, Client, Hex } from 'viem';
import type { SignedVoucher, Voucher } from './Types.js';
/**
 * Sign a voucher with an account.
 */
export declare function signVoucher(client: Client, account: Account, message: Voucher, escrowContract: Address.Address, chainId: number, authorizedSigner?: Address.Address | undefined): Promise<Hex>;
/**
 * Verify a voucher signature matches the expected signer.
 *
 * Only accepts raw secp256k1 signatures — the escrow contract verifies
 * via ecrecover. Keychain, p256, and webAuthn signatures are rejected.
 */
export declare function verifyVoucher(escrowContract: Address.Address, chainId: number, voucher: SignedVoucher, expectedSigner: Address.Address): Promise<boolean>;
/**
 * Parse a voucher from credential payload.
 */
export declare function parseVoucherFromPayload(channelId: Hex, cumulativeAmount: string, signature: Hex): SignedVoucher;
//# sourceMappingURL=Voucher.d.ts.map