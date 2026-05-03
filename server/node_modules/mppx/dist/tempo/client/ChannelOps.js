/**
 * Shared client-side channel operations.
 *
 * Provides the low-level helpers that both `session()`
 * and `sessionManager()` (orchestrator) rely on: escrow resolution, channel
 * ID computation, on-chain open/voucher/close payload construction, channel
 * recovery from on-chain state, and credential serialization.
 */
import { Hex } from 'ox';
import { encodeFunctionData, } from 'viem';
import { prepareTransactionRequest, signTransaction } from 'viem/actions';
import { Abis } from 'viem/tempo';
import * as Credential from '../../Credential.js';
import * as defaults from '../internal/defaults.js';
import { escrowAbi, getOnChainChannel } from '../session/Chain.js';
import * as Channel from '../session/Channel.js';
import { signVoucher } from '../session/Voucher.js';
export function resolveChainId(challenge) {
    const md = challenge.request.methodDetails;
    return md?.chainId ?? 0;
}
export function resolveEscrow(challenge, chainId, escrowContractOverride) {
    const challengeEscrow = challenge.request.methodDetails
        ?.escrowContract;
    const escrow = escrowContractOverride ??
        challengeEscrow ??
        defaults.escrowContract[chainId];
    if (!escrow)
        throw new Error('No `escrowContract` available. Provide it in parameters or ensure the server challenge includes it.');
    return escrow;
}
export function serializeCredential(challenge, payload, chainId, account) {
    return Credential.serialize({
        challenge,
        payload,
        source: `did:pkh:eip155:${chainId}:${account.address}`,
    });
}
export async function createVoucherPayload(client, account, channelId, cumulativeAmount, escrowContract, chainId, authorizedSigner) {
    const signature = await signVoucher(client, account, { channelId, cumulativeAmount }, escrowContract, chainId, authorizedSigner);
    return {
        action: 'voucher',
        channelId,
        cumulativeAmount: cumulativeAmount.toString(),
        signature,
    };
}
export async function createClosePayload(client, account, channelId, cumulativeAmount, escrowContract, chainId, authorizedSigner) {
    const signature = await signVoucher(client, account, { channelId, cumulativeAmount }, escrowContract, chainId, authorizedSigner);
    return {
        action: 'close',
        channelId,
        cumulativeAmount: cumulativeAmount.toString(),
        signature,
    };
}
export async function createOpenPayload(client, account, options) {
    const { escrowContract, payee, currency, deposit, initialAmount, chainId, feePayer } = options;
    const authorizedSigner = options.authorizedSigner ?? account.address;
    const salt = Hex.random(32);
    const channelId = Channel.computeId({
        authorizedSigner,
        chainId,
        escrowContract,
        payee,
        payer: account.address,
        salt,
        token: currency,
    });
    const approveData = encodeFunctionData({
        abi: Abis.tip20,
        functionName: 'approve',
        args: [escrowContract, deposit],
    });
    const openData = encodeFunctionData({
        abi: escrowAbi,
        functionName: 'open',
        args: [payee, currency, deposit, salt, authorizedSigner],
    });
    const prepared = await prepareTransactionRequest(client, {
        account,
        calls: [
            { to: currency, data: approveData },
            { to: escrowContract, data: openData },
        ],
        ...(feePayer && { feePayer: true }),
        feeToken: currency,
    });
    prepared.gas = prepared.gas + 5000n;
    const transaction = (await signTransaction(client, prepared));
    const signature = await signVoucher(client, account, { channelId, cumulativeAmount: initialAmount }, escrowContract, chainId, options.authorizedSigner);
    return {
        entry: {
            channelId,
            salt,
            cumulativeAmount: initialAmount,
            escrowContract,
            chainId,
            opened: true,
        },
        payload: {
            action: 'open',
            type: 'transaction',
            channelId,
            transaction,
            authorizedSigner,
            cumulativeAmount: initialAmount.toString(),
            signature,
        },
    };
}
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
export async function tryRecoverChannel(client, escrowContract, channelId, chainId) {
    try {
        const onChain = await getOnChainChannel(client, escrowContract, channelId);
        if (onChain.deposit > 0n && !onChain.finalized) {
            return {
                channelId,
                salt: '0x',
                cumulativeAmount: onChain.settled,
                escrowContract,
                chainId,
                opened: true,
            };
        }
    }
    catch { }
    return undefined;
}
//# sourceMappingURL=ChannelOps.js.map