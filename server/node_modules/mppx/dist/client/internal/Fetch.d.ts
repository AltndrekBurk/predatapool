import * as Challenge from '../../Challenge.js';
import * as AcceptPayment from '../../internal/AcceptPayment.js';
import type * as Method from '../../Method.js';
import type * as z from '../../zod.js';
/**
 * Creates a fetch wrapper that automatically handles 402 Payment Required responses.
 *
 * @example
 * ```ts
 * import { Fetch, tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const fetch = Fetch.from({
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Use the wrapped fetch — handles 402 automatically
 * const res = await fetch('https://api.example.com/resource')
 * ```
 *
 */
export declare function from<const methods extends readonly Method.AnyClient[]>(config: from.Config<methods>): from.Fetch<methods>;
/** Union of all context types from all methods that have context schemas. */
type AnyContextFor<methods extends readonly Method.AnyClient[]> = {
    [K in keyof methods]: NonNullable<methods[K]['context']> extends infer ctx ? ctx extends z.ZodMiniType ? z.input<ctx> : undefined : undefined;
}[number];
export declare namespace from {
    type Config<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = {
        /** Resolved `Accept-Payment` header and selection preferences. */
        acceptPayment?: AcceptPayment.Resolved<methods> | undefined;
        /** Controls when `Accept-Payment` is injected. @default 'always' */
        acceptPaymentPolicy?: 'always' | 'same-origin' | 'never' | {
            origins: readonly string[];
        } | undefined;
        /** Custom fetch function to wrap. Defaults to `globalThis.fetch`. */
        fetch?: typeof globalThis.fetch;
        /** Array of methods to use. */
        methods: methods;
        /** Called when a 402 challenge is received, before credential creation. */
        onChallenge?: ((challenge: Challenge.Challenge, helpers: {
            createCredential: (context?: AnyContextFor<methods>) => Promise<string>;
        }) => Promise<string | undefined>) | undefined;
    };
    type Fetch<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = (input: RequestInfo | URL, init?: RequestInit<methods>) => Promise<Response>;
    type RequestInit<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = globalThis.RequestInit & {
        /** Context to pass to the method intent's createCredential. */
        context?: AnyContextFor<methods>;
    };
}
/**
 * Replaces the global `fetch` with a payment-aware wrapper.
 *
 * @example
 * ```ts
 * import { Fetch, tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * Fetch.polyfill({
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Global fetch now handles 402 automatically
 * const res = await fetch('https://api.example.com/resource')
 * ```
 */
export declare function polyfill<const methods extends readonly Method.AnyClient[]>(config: polyfill.Config<methods>): void;
export declare namespace polyfill {
    type Config<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = from.Config<methods>;
}
/**
 * Restores the original `fetch` after calling `polyfill`.
 *
 * @example
 * ```ts
 * import { Fetch } from 'mppx/client'
 *
 * Fetch.polyfill({ methods: [...] })
 *
 * // ... use payment-aware fetch ...
 *
 * Fetch.restore()
 * ```
 */
export declare function restore(): void;
/** @internal Normalizes headers to a plain object for spreading. */
export declare function normalizeHeaders(headers: unknown): Record<string, string>;
export {};
//# sourceMappingURL=Fetch.d.ts.map