import * as z from '../zod.js';
/**
 * Stripe charge intent for one-time payments via Shared Payment Tokens (SPTs).
 *
 * @see https://github.com/tempoxyz/payment-auth-spec/blob/main/specs/methods/stripe/draft-stripe-charge-00.md
 */
export declare const charge: {
    readonly name: "stripe";
    readonly intent: "charge";
    readonly schema: {
        readonly credential: {
            readonly payload: z.ZodMiniObject<{
                externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
                spt: z.ZodMiniString<string>;
            }, z.core.$strip>;
        };
        readonly request: z.ZodMiniPipe<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            description: z.ZodMiniOptional<z.ZodMiniString<string>>;
            externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            metadata: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniString<string>>>;
            networkId: z.ZodMiniString<string>;
            paymentMethodTypes: z.ZodMiniArray<z.ZodMiniString<string>>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$strip>, z.ZodMiniTransform<{
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
};
//# sourceMappingURL=Methods.d.ts.map