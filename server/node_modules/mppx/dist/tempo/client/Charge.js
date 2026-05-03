import { prepareTransactionRequest, sendCallsSync, signTypedData, signTransaction, } from 'viem/actions';
import { tempo as tempo_chain } from 'viem/chains';
import { Actions } from 'viem/tempo';
import * as Credential from '../../Credential.js';
import * as Method from '../../Method.js';
import * as Account from '../../viem/Account.js';
import * as Client from '../../viem/Client.js';
import * as z from '../../zod.js';
import * as Attribution from '../Attribution.js';
import * as AutoSwap from '../internal/auto-swap.js';
import * as Charge_internal from '../internal/charge.js';
import * as defaults from '../internal/defaults.js';
import * as Proof from '../internal/proof.js';
import * as Methods from '../Methods.js';
/**
 * Creates a Tempo charge method intent for usage on the client.
 *
 * @example
 * ```ts
 * import { tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const charge = tempo.charge({
 *   account: privateKeyToAccount('0x...'),
 * })
 * ```
 */
export function charge(parameters = {}) {
    const { clientId } = parameters;
    const getClient = Client.getResolver({
        chain: tempo_chain,
        getClient: parameters.getClient,
        rpcUrl: defaults.rpcUrl,
    });
    const getAccount = Account.getResolver({ account: parameters.account });
    return Method.toClient(Methods.charge, {
        context: z.object({
            account: z.optional(z.custom()),
            autoSwap: z.optional(z.custom()),
            mode: z.optional(z.enum(Methods.chargeModes)),
        }),
        async createCredential({ challenge, context }) {
            const chainId = challenge.request.methodDetails?.chainId;
            const client = await getClient({ chainId });
            const account = getAccount(client, context);
            const { request } = challenge;
            const { amount, methodDetails } = request;
            // Zero-amount: sign EIP-712 typed data instead of creating a transaction.
            if (BigInt(amount) === 0n) {
                const signature = await signTypedData(client, {
                    account,
                    domain: Proof.domain(chainId),
                    types: Proof.types,
                    primaryType: 'Proof',
                    message: Proof.message(challenge.id, challenge.realm),
                });
                return Credential.serialize({
                    challenge,
                    payload: { signature, type: 'proof' },
                    source: Proof.proofSource({ address: account.address, chainId: chainId }),
                });
            }
            const currency = request.currency;
            if (parameters.expectedRecipients) {
                const allowed = new Set(parameters.expectedRecipients.map((a) => a.toLowerCase()));
                const splits = methodDetails?.splits;
                if (splits) {
                    for (const split of splits) {
                        if (!allowed.has(split.recipient.toLowerCase()))
                            throw new Error(`Unexpected split recipient: ${split.recipient}`);
                    }
                }
            }
            const supportedModes = methodDetails?.supportedModes ?? ['pull', 'push'];
            const mode = (() => {
                const explicitMode = context?.mode ?? parameters.mode;
                if (explicitMode) {
                    if (!supportedModes.includes(explicitMode))
                        throw new Error(`Challenge does not support ${explicitMode} mode.`);
                    return explicitMode;
                }
                const preferredMode = account.type === 'json-rpc' ? 'push' : 'pull';
                if (supportedModes.includes(preferredMode))
                    return preferredMode;
                return supportedModes[0];
            })();
            const memo = methodDetails?.memo
                ? methodDetails.memo
                : Attribution.encode({ challengeId: challenge.id, clientId, serverId: challenge.realm });
            const transfers = Charge_internal.getTransfers({
                amount,
                methodDetails: {
                    ...methodDetails,
                    memo,
                },
                recipient: request.recipient,
            });
            const transferCalls = transfers.map((transfer) => Actions.token.transfer.call({
                amount: BigInt(transfer.amount),
                ...(transfer.memo && { memo: transfer.memo }),
                to: transfer.recipient,
                token: currency,
            }));
            const autoSwap = AutoSwap.resolve(context?.autoSwap ?? parameters.autoSwap, AutoSwap.defaultCurrencies);
            const swapCalls = autoSwap
                ? await AutoSwap.findCalls(client, {
                    account: account.address,
                    amountOut: BigInt(amount),
                    tokenOut: currency,
                    tokenIn: autoSwap.tokenIn,
                    slippage: autoSwap.slippage,
                })
                : undefined;
            const calls = [...(swapCalls ?? []), ...transferCalls];
            const validBefore = (() => {
                const defaultExpiry = Math.floor(Date.now() / 1000) + 25;
                if (!challenge.expires)
                    return defaultExpiry;
                const challengeExpiry = Math.floor(new Date(challenge.expires).getTime() / 1000);
                return Math.min(defaultExpiry, challengeExpiry);
            })();
            if (mode === 'push') {
                const { receipts } = await sendCallsSync(client, {
                    account,
                    calls: calls,
                    experimental_fallback: true,
                });
                const hash = receipts?.[0]?.transactionHash;
                if (!hash)
                    throw new Error('No transaction receipt returned.');
                return Credential.serialize({
                    challenge,
                    payload: { hash, type: 'hash' },
                    source: `did:pkh:eip155:${chainId}:${account.address}`,
                });
            }
            const prepared = await prepareTransactionRequest(client, {
                account,
                calls,
                ...(methodDetails?.feePayer && { feePayer: true }),
                nonceKey: 'expiring',
                validBefore,
            });
            // FIXME: figure out gas estimation issue for fee payer tx
            prepared.gas = prepared.gas + 5000n;
            const signature = await signTransaction(client, prepared);
            return Credential.serialize({
                challenge,
                payload: { signature, type: 'transaction' },
                source: `did:pkh:eip155:${chainId}:${account.address}`,
            });
        },
    });
}
//# sourceMappingURL=Charge.js.map