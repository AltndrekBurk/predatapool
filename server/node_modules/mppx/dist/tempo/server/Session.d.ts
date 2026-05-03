/**
 * Server-side session payment method for request/response flows.
 *
 * Handles the full channel lifecycle (open, voucher, top-up, close) and
 * one-shot settlement. Each incoming request carries a session credential
 * with a cumulative voucher that the server validates and records.
 *
 * Use `session()` for standard HTTP request/response patterns where each
 * request is a discrete paid unit (for example, a page scrape or API call).
 * For long-lived connections that emit multiple paid events over a single
 * request, use {@link ../session/Sse} instead.
 */
import { type Address, type Hex, type Account as viem_Account, type Client as viem_Client } from 'viem';
import type { LooseOmit, NoExtraKeys } from '../../internal/types.js';
import * as Method from '../../Method.js';
import * as Store from '../../Store.js';
import * as Client from '../../viem/Client.js';
import type * as z from '../../zod.js';
import * as Account from '../internal/account.js';
import * as FeePayer from '../internal/fee-payer.js';
import type * as types from '../internal/types.js';
import * as Methods from '../Methods.js';
import * as ChannelStore from '../session/ChannelStore.js';
import * as Transport from './internal/transport.js';
/**
 * Creates a session payment server using the Method.toServer() pattern.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [
 *     tempo.session({
 *       store: myStore,
 *       recipient: '0x...',
 *       currency: '0x...',
 *       escrowContract: '0x...',
 *     }),
 *   ],
 *   realm: 'my-app',
 *   secretKey: '...',
 * })
 * ```
 */
export declare function session<const parameters extends session.Parameters>(p?: NoExtraKeys<parameters, session.Parameters>): Method.Server<{
    readonly name: "tempo";
    readonly intent: "session";
    readonly schema: {
        readonly credential: {
            readonly payload: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"open">;
                authorizedSigner: z.ZodMiniOptional<z.ZodMiniString<string>>;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                signature: z.ZodMiniString<string>;
                transaction: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"topUp">;
                additionalDeposit: z.ZodMiniString<string>;
                channelId: z.ZodMiniString<string>;
                transaction: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"voucher">;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                signature: z.ZodMiniString<string>;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"close">;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                signature: z.ZodMiniString<string>;
            }, z.core.$strip>], "action">;
        };
        readonly request: z.ZodMiniPipe<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            channelId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            escrowContract: z.ZodMiniOptional<z.ZodMiniString<string>>;
            feePayer: z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniCustom<viem_Account, viem_Account>]>, z.ZodMiniTransform<boolean, boolean | viem_Account>>>;
            minVoucherDelta: z.ZodMiniOptional<z.ZodMiniString<string>>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
            suggestedDeposit: z.ZodMiniOptional<z.ZodMiniString<string>>;
            unitType: z.ZodMiniString<string>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            methodDetails: {
                feePayer?: boolean | undefined;
                chainId?: number | undefined;
                minVoucherDelta?: string | undefined;
                channelId?: string | undefined;
                escrowContract: string | undefined;
            };
            suggestedDeposit?: string | undefined;
            amount: string;
            currency: string;
            unitType: string;
            recipient?: string | undefined;
        }, {
            amount: string;
            currency: string;
            decimals: number;
            unitType: string;
            chainId?: number | undefined;
            channelId?: string | undefined;
            escrowContract?: string | undefined;
            feePayer?: boolean | undefined;
            minVoucherDelta?: string | undefined;
            recipient?: string | undefined;
            suggestedDeposit?: string | undefined;
        }>>;
    };
}, session.DeriveDefaults<parameters>, parameters["sse"] extends false | undefined ? undefined : Transport.Sse>;
export declare namespace session {
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.session>, 'feePayer' | 'recipient'>;
    type FeePayerPolicy = Partial<FeePayer.Policy>;
    type Parameters = {
        /** TTL in milliseconds for cached on-chain channel state. After this duration, the server re-queries on-chain state during voucher handling to detect forced close requests. @default 5_000 */
        channelStateTtl?: number | undefined;
        /** Override the fee-sponsor policy used for sponsored open/topUp transactions. */
        feePayerPolicy?: FeePayerPolicy | undefined;
        /** Minimum voucher delta to accept (numeric string, default: "0"). */
        minVoucherDelta?: string | undefined;
        /**
         * Whether to wait for the open transaction to confirm on-chain before
         * responding. @default true
         *
         * When `false`, the transaction is simulated via `eth_estimateGas` and
         * broadcast without waiting for inclusion. The receipt will optimistically
         * report `status: 'success'` based on simulation alone — if the
         * transaction reverts on-chain after broadcast (e.g. due to a state
         * change between simulation and inclusion), the receipt will not reflect
         * the failure.
         */
        waitForConfirmation?: boolean | undefined;
        /**
         * Atomic store backend for channel state.
         *
         * Session state mutations must be linearizable across instances, so this
         * requires a {@link Store.AtomicStore}. Use `Store.memory()` for tests or
         * local single-process usage.
         */
        store?: Store.AtomicStore | undefined;
        /**
         * Enable SSE streaming.
         *
         * Pass `true` to enable with defaults, or an options object
         * to configure SSE (e.g. `{ poll: true }` for
         * Cloudflare Workers compatibility).
         */
        sse?: boolean | Transport.sse.Options | undefined;
        /** Testnet mode. */
        testnet?: boolean | undefined;
    } & Account.resolve.Parameters & Client.getResolver.Parameters & Defaults;
    type DeriveDefaults<parameters extends Parameters> = types.DeriveDefaults<parameters, Defaults> & {
        decimals: number;
        escrowContract: Address;
    };
}
/**
 * One-shot settle: reads highest voucher from store and submits on-chain.
 */
export declare function settle(store: ChannelStore.ChannelStore, client: viem_Client, channelId: Hex, options?: {
    escrowContract?: Address | undefined;
} & ({
    feePayer: viem_Account;
    account: viem_Account;
} | {
    feePayer?: undefined;
    account?: viem_Account | undefined;
})): Promise<Hex>;
/**
 * Charge against a channel's balance.
 *
 * Exported so consumers can deduct from a channel outside the `session()`
 * handler (e.g., custom middleware, the SSE `serve()` loop, or direct tests).
 *
 * Delegates to the shared `deductFromChannel` atomic helper and translates
 * failure modes into typed errors (`InsufficientBalanceError`, `ChannelClosedError`).
 */
export declare function charge(store: ChannelStore.ChannelStore, channelId: Hex, amount: bigint): Promise<ChannelStore.State>;
//# sourceMappingURL=Session.d.ts.map