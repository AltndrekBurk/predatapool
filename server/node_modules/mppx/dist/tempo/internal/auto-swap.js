import { readContract } from 'viem/actions';
import { Actions, Addresses } from 'viem/tempo';
import * as TempoAddress from './address.js';
import * as defaults from './defaults.js';
/** Basis-point denominator (100% = 10 000 bps). */
const bps = 10000n;
/** Default fallback currencies for auto-swap, in priority order. */
export const defaultCurrencies = [
    defaults.tokens.pathUsd,
    defaults.tokens.usdc,
];
/**
 * Finds the optimal swap calls to acquire `amountOut` of `tokenOut`,
 * returning an approve + buy call sequence if a viable route is found.
 *
 * Returns `undefined` if the account already holds enough of `tokenOut`
 * or no viable swap route exists from the given input tokens.
 */
export async function findCalls(client, parameters) {
    const { account, amountOut, tokenOut, tokenIn, slippage } = parameters;
    const candidates = tokenIn.filter((t) => !TempoAddress.isEqual(t, tokenOut));
    const balanceResults = await Promise.allSettled([
        readContract(client, Actions.token.getBalance.call({ account, token: tokenOut })),
        ...candidates.map((t) => readContract(client, Actions.token.getBalance.call({ account, token: t }))),
    ]);
    // If the account already has enough of the target token, no swap needed.
    const targetBalance = balanceResults[0];
    if (targetBalance.status === 'fulfilled' && targetBalance.value >= amountOut)
        return undefined;
    // Find first candidate with enough balance to cover a swap.
    for (let i = 0; i < candidates.length; i++) {
        const result = balanceResults[i + 1];
        if (result.status !== 'fulfilled')
            continue;
        const balance = result.value;
        if (balance <= 0n)
            continue;
        const tokenIn = candidates[i];
        try {
            const quotedAmountIn = await Actions.dex.getBuyQuote(client, {
                tokenIn,
                tokenOut,
                amountOut,
            });
            if (balance >= quotedAmountIn) {
                const maxAmountIn = quotedAmountIn + (quotedAmountIn * BigInt(Math.round(slippage * 100))) / bps;
                return [
                    Actions.token.approve.call({
                        token: tokenIn,
                        spender: Addresses.stablecoinDex,
                        amount: maxAmountIn,
                    }),
                    Actions.dex.buy.call({
                        tokenIn,
                        tokenOut,
                        amountOut,
                        maxAmountIn,
                    }),
                ];
            }
        }
        catch { }
    }
    throw new InsufficientFundsError({ currency: tokenOut });
}
/** Resolves an auto-swap configuration value into concrete currencies and slippage. */
export function resolve(value, defaultCurrencies) {
    if (!value)
        return false;
    if (value === true)
        return { tokenIn: defaultCurrencies, slippage: 1 };
    const tokenIn = value.tokenIn
        ? [
            ...value.tokenIn,
            ...defaultCurrencies.filter((d) => !value.tokenIn.some((c) => TempoAddress.isEqual(c, d))),
        ]
        : defaultCurrencies;
    return {
        tokenIn,
        slippage: value.slippage ?? 1,
    };
}
export class InsufficientFundsError extends Error {
    name = 'InsufficientFundsError';
    constructor({ currency }) {
        super(`Insufficient funds: no balance in ${currency} and no viable swap route from fallback currencies.`);
    }
}
//# sourceMappingURL=auto-swap.js.map