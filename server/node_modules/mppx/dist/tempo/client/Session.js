import { parseUnits } from 'viem';
import { tempo as tempo_chain } from 'viem/chains';
import * as Method from '../../Method.js';
import * as Account from '../../viem/Account.js';
import * as Client from '../../viem/Client.js';
import * as z from '../../zod.js';
import * as defaults from '../internal/defaults.js';
import * as Methods from '../Methods.js';
import { signVoucher } from '../session/Voucher.js';
import { createOpenPayload, createVoucherPayload, resolveEscrow, serializeCredential, tryRecoverChannel, } from './ChannelOps.js';
export const sessionContextSchema = z.object({
    account: z.optional(z.custom()),
    action: z.optional(z.enum(['open', 'topUp', 'voucher', 'close'])),
    channelId: z.optional(z.string()),
    cumulativeAmount: z.optional(z.amount()),
    cumulativeAmountRaw: z.optional(z.string()),
    transaction: z.optional(z.string()),
    authorizedSigner: z.optional(z.string()),
    additionalDeposit: z.optional(z.amount()),
    additionalDepositRaw: z.optional(z.string()),
    depositRaw: z.optional(z.string()),
});
/**
 * Creates a session payment method for use with `Mppx.create()`.
 *
 * Supports both auto mode (set `deposit` to manage channels automatically)
 * and manual mode (pass `context.action` to control each step).
 *
 * @example
 * ```ts
 * // Auto mode
 * import { Mppx, tempo } from 'mppx/client'
 *
 * const mppx = Mppx.create({
 *   methods: [tempo({
 *     account: privateKeyToAccount('0x...'),
 *     deposit: '10',
 *   })],
 * })
 *
 * const res = await mppx.fetch('/api/chat?prompt=hello')
 * ```
 *
 * @example
 * ```ts
 * // Manual mode
 * const mppx = Mppx.create({
 *   methods: [tempo({ account })],
 * })
 *
 * const credential = await mppx.createCredential(response, {
 *   action: 'voucher',
 *   channelId: '0x...',
 *   cumulativeAmount: '1',
 * })
 * ```
 */
export function session(parameters = {}) {
    const { decimals = defaults.decimals } = parameters;
    const getClient = Client.getResolver({
        chain: tempo_chain,
        getClient: parameters.getClient,
        rpcUrl: defaults.rpcUrl,
    });
    const getAccount = Account.getResolver({ account: parameters.account });
    const getAuthorizedSigner = (account) => parameters.authorizedSigner ??
        account.accessKeyAddress;
    const maxDeposit = parameters.maxDeposit !== undefined ? parseUnits(parameters.maxDeposit, decimals) : undefined;
    const escrowContractMap = new Map();
    const channels = new Map();
    const channelIdToKey = new Map();
    function notifyUpdate(entry) {
        parameters.onChannelUpdate?.(entry);
    }
    function channelKey(payee, currency, escrow) {
        return `${payee.toLowerCase()}:${currency.toLowerCase()}:${escrow.toLowerCase()}`;
    }
    function resolveEscrowCached(challenge, chainId, channelId) {
        if (channelId) {
            const cached = escrowContractMap.get(channelId);
            if (cached)
                return cached;
        }
        return resolveEscrow(challenge, chainId, parameters.escrowContract);
    }
    async function autoManageCredential(challenge, account, context) {
        const md = challenge.request.methodDetails;
        const chainId = md?.chainId ?? 0;
        const client = await getClient({ chainId });
        const escrowContract = resolveEscrowCached(challenge, chainId);
        const payee = challenge.request.recipient;
        const currency = challenge.request.currency;
        const amount = BigInt(challenge.request.amount);
        const suggestedDepositRaw = challenge.request
            .suggestedDeposit;
        const suggestedDeposit = suggestedDepositRaw ? BigInt(suggestedDepositRaw) : undefined;
        const deposit = (() => {
            if (context?.depositRaw)
                return BigInt(context.depositRaw);
            if (parameters.deposit !== undefined)
                return parseUnits(parameters.deposit, decimals);
            if (suggestedDeposit !== undefined && maxDeposit !== undefined)
                return suggestedDeposit < maxDeposit ? suggestedDeposit : maxDeposit;
            if (maxDeposit !== undefined)
                return maxDeposit;
            if (suggestedDeposit !== undefined)
                return suggestedDeposit;
            throw new Error('No deposit amount available. Set `deposit`, `maxDeposit`, or ensure the server challenge includes `suggestedDeposit`.');
        })();
        const authorizedSigner = getAuthorizedSigner(account);
        const key = channelKey(payee, currency, escrowContract);
        let entry = channels.get(key);
        if (!entry) {
            const suggestedChannelId = (context?.channelId ?? md?.channelId);
            if (suggestedChannelId) {
                const recovered = await tryRecoverChannel(client, escrowContract, suggestedChannelId, chainId);
                if (recovered) {
                    const contextCumulative = context?.cumulativeAmountRaw
                        ? BigInt(context.cumulativeAmountRaw)
                        : context?.cumulativeAmount
                            ? parseUnits(context.cumulativeAmount, decimals)
                            : undefined;
                    if (contextCumulative !== undefined)
                        recovered.cumulativeAmount = contextCumulative;
                    channels.set(key, recovered);
                    channelIdToKey.set(recovered.channelId, key);
                    escrowContractMap.set(recovered.channelId, escrowContract);
                    entry = recovered;
                    notifyUpdate(entry);
                }
                else if (context?.channelId) {
                    throw new Error(`Channel ${context.channelId} cannot be reused (closed or not found on-chain).`);
                }
            }
        }
        let payload;
        if (entry?.opened) {
            entry.cumulativeAmount += amount;
            payload = await createVoucherPayload(client, account, entry.channelId, entry.cumulativeAmount, escrowContract, chainId, authorizedSigner);
            notifyUpdate(entry);
        }
        else {
            const result = await createOpenPayload(client, account, {
                authorizedSigner,
                escrowContract,
                payee,
                currency,
                deposit,
                initialAmount: amount,
                chainId,
                feePayer: md?.feePayer,
            });
            channels.set(key, result.entry);
            channelIdToKey.set(result.entry.channelId, key);
            escrowContractMap.set(result.entry.channelId, escrowContract);
            payload = result.payload;
            notifyUpdate(result.entry);
        }
        return serializeCredential(challenge, payload, chainId, account);
    }
    async function manualCredential(challenge, account, context) {
        const md = challenge.request.methodDetails;
        const chainId = md?.chainId ?? 0;
        const client = await getClient({ chainId });
        const action = context.action;
        const { channelId: channelIdRaw, transaction, authorizedSigner: contextAuthorizedSigner, } = context;
        const authorizedSigner = contextAuthorizedSigner ?? getAuthorizedSigner(account);
        const channelId = channelIdRaw;
        const cumulativeAmount = context.cumulativeAmountRaw
            ? BigInt(context.cumulativeAmountRaw)
            : context.cumulativeAmount
                ? parseUnits(context.cumulativeAmount, decimals)
                : undefined;
        const resolvedAdditionalDeposit = context.additionalDepositRaw
            ? BigInt(context.additionalDepositRaw)
            : context.additionalDeposit
                ? parseUnits(context.additionalDeposit, decimals)
                : undefined;
        const escrowContract = resolveEscrowCached(challenge, chainId, channelId);
        escrowContractMap.set(channelId, escrowContract);
        let payload;
        switch (action) {
            case 'open': {
                if (!transaction)
                    throw new Error('transaction required for open action');
                if (cumulativeAmount === undefined)
                    throw new Error('cumulativeAmount required for open action');
                const signature = await signVoucher(client, account, { channelId, cumulativeAmount }, escrowContract, chainId, authorizedSigner);
                payload = {
                    action: 'open',
                    type: 'transaction',
                    channelId,
                    transaction: transaction,
                    authorizedSigner: authorizedSigner ?? account.address,
                    cumulativeAmount: cumulativeAmount.toString(),
                    signature,
                };
                break;
            }
            case 'topUp':
                if (!transaction)
                    throw new Error('transaction required for topUp action');
                if (resolvedAdditionalDeposit === undefined)
                    throw new Error('additionalDeposit required for topUp action');
                payload = {
                    action: 'topUp',
                    type: 'transaction',
                    channelId,
                    transaction: transaction,
                    additionalDeposit: resolvedAdditionalDeposit.toString(),
                };
                break;
            case 'voucher': {
                if (cumulativeAmount === undefined)
                    throw new Error('cumulativeAmount required for voucher action');
                payload = await createVoucherPayload(client, account, channelId, cumulativeAmount, escrowContract, chainId, authorizedSigner);
                const key = channelIdToKey.get(channelId);
                if (key) {
                    const entry = channels.get(key);
                    if (entry) {
                        entry.cumulativeAmount =
                            entry.cumulativeAmount > cumulativeAmount ? entry.cumulativeAmount : cumulativeAmount;
                        notifyUpdate(entry);
                    }
                }
                break;
            }
            case 'close': {
                if (cumulativeAmount === undefined)
                    throw new Error('cumulativeAmount required for close action');
                const signature = await signVoucher(client, account, { channelId, cumulativeAmount }, escrowContract, chainId, authorizedSigner);
                payload = {
                    action: 'close',
                    channelId,
                    cumulativeAmount: cumulativeAmount.toString(),
                    signature,
                };
                const closeKey = channelIdToKey.get(channelId);
                if (closeKey) {
                    const entry = channels.get(closeKey);
                    if (entry) {
                        entry.opened = false;
                        entry.cumulativeAmount =
                            entry.cumulativeAmount > cumulativeAmount ? entry.cumulativeAmount : cumulativeAmount;
                        notifyUpdate(entry);
                    }
                }
                break;
            }
        }
        return serializeCredential(challenge, payload, chainId, account);
    }
    return Method.toClient(Methods.session, {
        context: sessionContextSchema,
        async createCredential({ challenge, context }) {
            const chainId = challenge.request.methodDetails?.chainId ?? 0;
            const client = await getClient({ chainId });
            const account = getAccount(client, context);
            if (!context?.action && (parameters.deposit !== undefined || maxDeposit !== undefined))
                return autoManageCredential(challenge, account, context);
            if (context?.action)
                return manualCredential(challenge, account, context);
            throw new Error('No `action` in context and no `deposit` or `maxDeposit` configured. Either provide context with action/channelId/cumulativeAmount, or configure `deposit`/`maxDeposit` for auto-management.');
        },
    });
}
//# sourceMappingURL=Session.js.map