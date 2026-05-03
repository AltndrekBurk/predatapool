import { charge as charge_ } from './Charge.js';
/**
 * Creates a Stripe `charge` client method.
 *
 * @example
 * ```ts
 * import { Mppx, stripe } from 'mppx/client'
 *
 * const mppx = Mppx.create({
 *   methods: [
 *     stripe({
 *       createToken: async (params) => {
 *         const res = await fetch('/api/create-spt', {
 *           method: 'POST',
 *           headers: { 'Content-Type': 'application/json' },
 *           body: JSON.stringify(params),
 *         })
 *         const { spt } = await res.json()
 *         return spt
 *       },
 *       paymentMethod: 'pm_card_visa',
 *     }),
 *   ],
 * })
 * ```
 */
export declare function stripe(parameters: stripe.Parameters): readonly [import("../../Method.js").Client<{
    readonly name: "stripe";
    readonly intent: "charge";
    readonly schema: {
        readonly credential: {
            readonly payload: import("zod/mini").ZodMiniObject<{
                externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                spt: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>;
        };
        readonly request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            metadata: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniRecord<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniString<string>>>;
            networkId: import("zod/mini").ZodMiniString<string>;
            paymentMethodTypes: import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
            amount: string;
            methodDetails: {
                metadata?: Record<string, string> | undefined;
                networkId: string;
                paymentMethodTypes: string[];
            };
            currency: string;
            description?: string | undefined;
            externalId?: string | undefined;
            recipient?: string | undefined;
        }, {
            amount: string;
            currency: string;
            decimals: number;
            networkId: string;
            paymentMethodTypes: string[];
            description?: string | undefined;
            externalId?: string | undefined;
            metadata?: Record<string, string> | undefined;
            recipient?: string | undefined;
        }>>;
    };
}, import("zod/mini").ZodMiniObject<{
    paymentMethod: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
}, import("zod/v4/core").$strip>>];
export declare namespace stripe {
    type Parameters = charge_.Parameters;
    /** Creates a Stripe `charge` client method for SPT-based payments. */
    const charge: typeof charge_;
}
//# sourceMappingURL=Methods.d.ts.map