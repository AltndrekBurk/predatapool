import type { LooseOmit, OneOf } from '../../internal/types.js';
import * as Method from '../../Method.js';
import type * as Html from '../../server/internal/html/config.ts';
import type * as z from '../../zod.js';
import type { StripeClient, CreatePaymentMethodFromElements, StripeElementsOptionsMode, StripePaymentElementOptions } from '../internal/types.js';
import * as Methods from '../Methods.js';
/**
 * Creates a Stripe charge method intent for usage on the server.
 *
 * Verifies payment by creating a Stripe PaymentIntent with the provided SPT.
 *
 * Accepts either a `client` (a pre-configured Stripe SDK instance) or a raw
 * `secretKey`. Using `client` is recommended—it lets you configure retries,
 * API version, and other options on the Stripe instance you control.
 *
 * @example
 * ```ts
 * import Stripe from 'stripe'
 * import { stripe } from 'mppx/server'
 *
 * const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!)
 * const charge = stripe.charge({ client: stripeClient, networkId: 'internal', paymentMethodTypes: ['card'] })
 * ```
 *
 * @example
 * ```ts
 * import { stripe } from 'mppx/server'
 *
 * const charge = stripe.charge({ secretKey: 'sk_...', networkId: 'internal', paymentMethodTypes: ['card'] })
 * ```
 */
export declare function charge<const parameters extends charge.Parameters>(parameters: parameters): Method.Server<{
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
}, charge.DeriveDefaults<parameters>, undefined>;
export declare namespace charge {
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.charge>, 'recipient'>;
    type Parameters = {
        /** Render payment page when Accept header is text/html (e.g. in browsers) */
        html?: ({
            createTokenUrl: string;
            elements?: {
                options?: StripeElementsOptionsMode | undefined;
                paymentOptions?: StripePaymentElementOptions | undefined;
                createPaymentMethodOptions?: CreatePaymentMethodFromElements | undefined;
            } | undefined;
            publishableKey: string;
        } & Html.Config) | undefined;
        /** Optional metadata to include in SPT creation requests. */
        metadata?: Record<string, string> | undefined;
    } & Defaults & OneOf<{
        /** Pre-configured Stripe SDK instance. Any object matching the duck-typed `StripeClient` shape works. */
        client: StripeClient;
    } | {
        /** Stripe secret API key. */
        secretKey: string;
    }>;
    type DeriveDefaults<parameters extends Parameters> = Pick<parameters, Extract<keyof parameters, keyof Defaults>> & {
        decimals: number;
    };
}
//# sourceMappingURL=Charge.d.ts.map