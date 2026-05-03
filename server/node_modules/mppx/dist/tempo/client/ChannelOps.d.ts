/**
 * Shared client-side channel operations.
 *
 * Provides the low-level helpers that both `session()`
 * and `sessionManager()` (orchestrator) rely on: escrow resolution, channel
 * ID computation, on-chain open/voucher/close payload construction, channel
 * recovery from on-chain state, and credential serialization.
 */
import { Hex } from 'ox';
import { type Address, type Account as viem_Account, type Client as viem_Client } from 'viem';
import type { Challenge } from '../../Challenge.js';
import type { SessionCredentialPayload } from '../session/Types.js';
export type ChannelEntry = {
    channelId: Hex.Hex;
    salt: Hex.Hex;
    cumulativeAmount: bigint;
    escrowContract: Address;
    chainId: number;
    opened: boolean;
};
export declare function resolveChainId(challenge: Challenge): number;
export declare function resolveEscrow(challenge: {
    request: {
        methodDetails?: unknown;
    };
}, chainId: number, escrowContractOverride?: Address): Address;
export declare function serializeCredential(challenge: Challenge, payload: SessionCredentialPayload, chainId: number, account: viem_Account): string;
export declare function createVoucherPayload(client: viem_Client, account: viem_Account, channelId: Hex.Hex, cumulativeAmount: bigint, escrowContract: Address, chainId: number, authorizedSigner?: Address | undefined): Promise<SessionCredentialPayload>;
export declare function createClosePayload(client: viem_Client, account: viem_Account, channelId: Hex.Hex, cumulativeAmount: bigint, escrowContract: Address, chainId: number, authorizedSigner?: Address | undefined): Promise<SessionCredentialPayload>;
export declare function createOpenPayload(client: viem_Client, account: viem_Account, options: {
    authorizedSigner?: Address | undefined;
    escrowContract: Address;
    payee: Address;
    currency: Address;
    deposit: bigint;
    initialAmount: bigint;
    chainId: number;
    feePayer?: boolean | undefined;
}): Promise<{
    entry: ChannelEntry;
    payload: SessionCredentialPayload;
}>;
/**
 * Attempt to recover an existing on-chain channel by reading its state.
 *
 * If the channel has a positive deposit and is not finalized, returns a
 * {@link ChannelEntry} with `cumulativeAmount` set to the on-chain settled
 * amount (the safe starting point for new vouchers).
 *
 * Returns `undefined` if the channel doesn't exist, has zero deposit,
 * or is already finalized.
 */
export declare function tryRecoverChannel(client: viem_Client, escrowContract: Address, channelId: Hex.Hex, chainId: number): Promise<ChannelEntry | undefined>;
//# sourceMappingURL=ChannelOps.d.ts.map