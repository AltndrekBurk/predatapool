import type { LooseOmit, NoExtraKeys } from '../../internal/types.js';
import * as Method from '../../Method.js';
import type * as Html from '../../server/internal/html/config.ts';
import * as Store from '../../Store.js';
import * as Client from '../../viem/Client.js';
import type * as z from '../../zod.js';
import * as Account from '../internal/account.js';
import * as FeePayer from '../internal/fee-payer.js';
import type * as types from '../internal/types.js';
import * as Methods from '../Methods.js';
/**
 * Creates a Tempo charge method intent for usage on the server.
 *
 * @example
 * ```ts
 * import { tempo } from 'mppx/server'
 *
 * const charge = tempo.charge()
 * ```
 */
export declare function charge<const parameters extends charge.Parameters>(parameters?: NoExtraKeys<parameters, charge.Parameters>): Method.Server<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        readonly credential: {
            readonly payload: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
                hash: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"hash">;
            }, z.core.$strip>, z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"proof">;
            }, z.core.$strip>], "type">;
        };
        readonly request: z.ZodMiniPipe<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            description: z.ZodMiniOptional<z.ZodMiniString<string>>;
            externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            feePayer: z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniCustom<import("viem").Account, import("viem").Account>]>, z.ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: z.ZodMiniOptional<z.ZodMiniString<string>>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
            splits: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                amount: z.ZodMiniString<string>;
                memo: z.ZodMiniOptional<z.ZodMiniString<string>>;
                recipient: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
            }, z.core.$strip>>>;
            supportedModes: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniEnum<{
                push: "push";
                pull: "pull";
            }>>>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            methodDetails?: {
                supportedModes?: ("push" | "pull")[] | undefined;
                splits?: {
                    amount: string;
                    recipient: `0x${string}`;
                    memo?: string | undefined;
                }[] | undefined;
                memo?: string | undefined;
                feePayer?: boolean | undefined;
                chainId?: number | undefined;
            } | undefined;
            amount: string;
            currency: string;
            description?: string | undefined;
            externalId?: string | undefined;
            recipient?: string | undefined;
        }, {
            amount: string;
            currency: string;
            decimals: number;
            chainId?: number | undefined;
            description?: string | undefined;
            externalId?: string | undefined;
            feePayer?: boolean | undefined;
            memo?: string | undefined;
            recipient?: string | undefined;
            splits?: {
                amount: string;
                recipient: `0x${string}`;
                memo?: string | undefined;
            }[] | undefined;
            supportedModes?: ("push" | "pull")[] | undefined;
        }>>;
    };
}, charge.DeriveDefaults<parameters>, undefined>;
export declare namespace charge {
    type StoreItemMap = {
        [key: `mppx:charge:${string}`]: number;
    };
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.charge>, 'feePayer' | 'recipient'>;
    type Parameters = {
        /** Render payment page when Accept header is text/html (e.g. in browsers) */
        html?: boolean | Html.Config | undefined;
        /**
         * Override the fee-sponsor policy used when co-signing Tempo charge
         * transactions. Defaults resolve per chain, including a higher
         * priority-fee ceiling on Moderato.
         *
         * If you increase `maxGas` or `maxFeePerGas`, you may also need to raise
         * `maxTotalFee` so the combined fee budget remains valid.
         */
        feePayerPolicy?: FeePayerPolicy | undefined;
        /** Testnet mode. */
        testnet?: boolean | undefined;
        /**
         * Store for charge replay protection.
         *
         * Non-zero charge flows default to an in-memory store if omitted. For
         * zero-dollar proof auth, replay prevention is enabled only when a store
         * is explicitly provided; otherwise proofs remain reusable until the
         * challenge expires.
         *
         * Replay protection requires a {@link Store.AtomicStore} so replay markers
         * can be written atomically.
         *
         * Use a shared store in multi-instance deployments so consumed hashes and
         * proofs are visible across all server instances.
         */
        store?: Store.AtomicStore | undefined;
        /**
         * Whether to wait for the charge transaction to confirm on-chain before
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
    } & Client.getResolver.Parameters & Account.resolve.Parameters & Defaults;
    type DeriveDefaults<parameters extends Parameters> = types.DeriveDefaults<parameters, Defaults> & {
        decimals: number;
    };
    type FeePayerPolicy = Partial<FeePayer.Policy>;
}
//# sourceMappingURL=Charge.d.ts.map