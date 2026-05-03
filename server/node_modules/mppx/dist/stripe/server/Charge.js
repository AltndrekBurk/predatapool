import { PaymentActionRequiredError, VerificationFailedError } from '../../Errors.js';
import * as Expires from '../../Expires.js';
import * as Method from '../../Method.js';
import { stripePreviewVersion } from '../internal/constants.js';
import * as Methods from '../Methods.js';
import { html as htmlContent } from './internal/html.gen.js';
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
export function charge(parameters) {
    const { amount, currency, decimals, description, externalId, html: { text: htmlText, theme: htmlTheme, ...htmlConfig } = {}, metadata, networkId, paymentMethodTypes, } = parameters;
    const client = 'client' in parameters ? parameters.client : undefined;
    const secretKey = 'secretKey' in parameters ? parameters.secretKey : undefined;
    return Method.toServer(Methods.charge, {
        defaults: {
            amount,
            currency,
            decimals,
            description,
            externalId,
            metadata,
            networkId,
            paymentMethodTypes,
        },
        html: 'publishableKey' in htmlConfig && htmlConfig.publishableKey && htmlConfig.createTokenUrl
            ? {
                config: htmlConfig,
                content: htmlContent,
                formatAmount: (request) => {
                    try {
                        const formatter = new Intl.NumberFormat('en', {
                            style: 'currency',
                            currency: request.currency,
                            currencyDisplay: 'narrowSymbol',
                        });
                        const decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
                        return formatter.format(Number(request.amount) / 10 ** decimals);
                    }
                    catch {
                        return `${request.currency}${request.amount}`;
                    }
                },
                text: htmlText,
                theme: htmlTheme,
            }
            : undefined,
        async verify({ credential, request }) {
            const { challenge } = credential;
            const resolvedRequest = (() => {
                const parsed = Methods.charge.schema.request.safeParse(request);
                if (parsed.success)
                    return parsed.data;
                // verifyCredential() passes the HMAC-bound challenge request, which is
                // already in canonical output form and should not be transformed again.
                return request;
            })();
            Expires.assert(challenge.expires, challenge.id);
            const parsed = Methods.charge.schema.credential.payload.safeParse(credential.payload);
            if (!parsed.success)
                throw new Error('Invalid credential payload: missing or malformed spt');
            const { spt, externalId: credentialExternalId } = parsed.data;
            const userMetadata = resolvedRequest.methodDetails?.metadata;
            const resolvedMetadata = { ...buildAnalytics({ credential }), ...userMetadata };
            const pi = client
                ? await createWithClient({
                    client,
                    challenge,
                    request: resolvedRequest,
                    spt,
                    metadata: resolvedMetadata,
                })
                : await createWithSecretKey({
                    secretKey: secretKey,
                    challenge,
                    request: resolvedRequest,
                    spt,
                    metadata: resolvedMetadata,
                });
            if (pi.replayed)
                throw new VerificationFailedError({ reason: 'Payment has already been processed.' });
            if (pi.status === 'requires_action') {
                throw new PaymentActionRequiredError({ reason: 'Stripe PaymentIntent requires action' });
            }
            if (pi.status !== 'succeeded')
                throw new Error(`Stripe PaymentIntent status: ${pi.status}`);
            return {
                method: 'stripe',
                status: 'success',
                timestamp: new Date().toISOString(),
                reference: pi.id,
                ...(credentialExternalId ? { externalId: credentialExternalId } : {}),
            };
        },
    });
}
/** Creates a PaymentIntent using the Stripe SDK client. */
async function createWithClient(parameters) {
    const { client, challenge, metadata, request, spt } = parameters;
    try {
        const result = await client.paymentIntents.create({
            amount: Number(request.amount),
            automatic_payment_methods: { allow_redirects: 'never', enabled: true },
            confirm: true,
            currency: request.currency,
            metadata,
            // `shared_payment_granted_token` is not yet in the Stripe SDK types (SPTs are in private preview).
            shared_payment_granted_token: spt,
        }, { idempotencyKey: `mppx_${challenge.id}_${spt}`, apiVersion: stripePreviewVersion });
        // https://docs.stripe.com/error-low-level#idempotency
        const replayed = result.lastResponse?.headers?.['idempotent-replayed'] === 'true';
        return { id: result.id, status: result.status, replayed };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new VerificationFailedError({
            reason: `Stripe PaymentIntent failed: ${detail}`,
        });
    }
}
/** Creates a PaymentIntent using a raw secret key and fetch. */
async function createWithSecretKey(parameters) {
    const { secretKey, challenge, metadata, request, spt } = parameters;
    const body = new URLSearchParams({
        amount: request.amount,
        'automatic_payment_methods[allow_redirects]': 'never',
        'automatic_payment_methods[enabled]': 'true',
        confirm: 'true',
        currency: request.currency,
        shared_payment_granted_token: spt,
    });
    for (const [key, value] of Object.entries(metadata)) {
        body.set(`metadata[${key}]`, value);
    }
    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${btoa(`${secretKey}:`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': `mppx_${challenge.id}_${spt}`,
            'Stripe-Version': stripePreviewVersion,
        },
        body,
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const detail = (() => {
            try {
                const parsed = JSON.parse(body);
                return parsed.error?.message ?? body;
            }
            catch {
                return body;
            }
        })();
        throw new VerificationFailedError({
            reason: `Stripe PaymentIntent failed: ${detail}`,
        });
    }
    // https://docs.stripe.com/error-low-level#idempotency
    const replayed = response.headers.get('idempotent-replayed') === 'true';
    const result = (await response.json());
    return { ...result, replayed };
}
/** @internal */
function buildAnalytics(parameters) {
    const { credential } = parameters;
    const { challenge } = credential;
    return {
        mpp_version: '1',
        mpp_is_mpp: 'true',
        mpp_intent: challenge.intent,
        mpp_challenge_id: challenge.id,
        mpp_server_id: challenge.realm,
        ...(credential.source ? { mpp_client_id: credential.source } : {}),
    };
}
//# sourceMappingURL=Charge.js.map