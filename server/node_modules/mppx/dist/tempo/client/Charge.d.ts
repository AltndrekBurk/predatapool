import type { Address } from 'viem';
import * as Method from '../../Method.js';
import * as Account from '../../viem/Account.js';
import * as Client from '../../viem/Client.js';
import * as z from '../../zod.js';
import * as AutoSwap from '../internal/auto-swap.js';
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
export declare function charge(parameters?: charge.Parameters): Method.Client<{
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
}, z.ZodMiniObject<{
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
    autoSwap: z.ZodMiniOptional<z.ZodMiniCustom<AutoSwap.resolve.Value, AutoSwap.resolve.Value>>;
    mode: z.ZodMiniOptional<z.ZodMiniEnum<{
        push: "push";
        pull: "pull";
    }>>;
}, z.core.$strip>>;
export declare namespace charge {
    type AutoSwap = AutoSwap.resolve.Value;
    type Parameters = {
        /**
         * Automatically swap from a fallback currency (pathUsd, USDC.e) via the
         * Tempo DEX when the user lacks sufficient balance of the target currency.
         *
         * @default false
         */
        autoSwap?: AutoSwap | undefined;
        /** Client identifier used to derive the client fingerprint in attribution memos. */
        clientId?: string | undefined;
        /**
         * Allowlist of expected split recipient addresses. When set, the client
         * rejects any challenge whose split recipients are not in this list.
         */
        expectedRecipients?: readonly Address[] | undefined;
        /**
         * Controls how the charge transaction is submitted.
         *
         * - `'push'`: Client broadcasts the transaction and sends the tx hash to the server.
         * - `'pull'`: Client signs the transaction and sends the serialized tx to the server for broadcast.
         *
         * If the server advertises `supportedModes`, this setting must be one of
         * the supported values for the challenge.
         *
         * @default `'push'` for JSON-RPC accounts, `'pull'` for local accounts.
         */
        mode?: Methods.ChargeMode | undefined;
    } & Account.getResolver.Parameters & Client.getResolver.Parameters;
}
//# sourceMappingURL=Charge.d.ts.map