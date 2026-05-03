import { charge as charge_ } from './Charge.js';
/**
 * Creates a Stripe `charge` method for usage on the server.
 *
 * @example
 * ```ts
 * import { Mppx, stripe } from 'mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [stripe({ secretKey: 'sk_...' })],
 * })
 * ```
 */
export function stripe(parameters) {
    return [stripe.charge(parameters)];
}
(function (stripe) {
    /** Creates a Stripe `charge` method for SPT-based payments. */
    stripe.charge = charge_;
})(stripe || (stripe = {}));
//# sourceMappingURL=Methods.js.map