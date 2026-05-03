import * as Challenge from '../Challenge.js';
import * as Credential from '../Credential.js';
import * as Mcp from '../Mcp.js';
/**
 * Creates a custom client-side transport.
 *
 * @example
 * ```ts
 * import { Transport } from 'mppx/client'
 *
 * const custom = Transport.from({
 *   name: 'custom',
 *   isPaymentRequired(response) { ... },
 *   getChallenge(response) { ... },
 *   setCredential(request, credential) { ... },
 * })
 * ```
 */
export function from(transport) {
    return transport;
}
/**
 * HTTP transport for client-side payment handling.
 *
 * - Detects payment required via 402 status
 * - Extracts challenges from `WWW-Authenticate` header
 * - Sends credentials via `Authorization` header
 */
export function http() {
    return from({
        name: 'http',
        isPaymentRequired(response) {
            return response.status === 402;
        },
        getChallenges(response) {
            return Challenge.fromResponseList(response);
        },
        getChallenge(response) {
            return Challenge.fromResponse(response);
        },
        setCredential(request, credential) {
            const headers = new Headers(request.headers);
            headers.set('Authorization', credential);
            return { ...request, headers };
        },
    });
}
/**
 * MCP transport for client-side payment handling.
 *
 * - Detects payment required via error code -32042
 * - Extracts challenges from `error.data.challenges[0]`
 * - Sends credentials via `_meta["org.paymentauth/credential"]`
 */
export function mcp() {
    return from({
        name: 'mcp',
        isPaymentRequired(response) {
            return 'error' in response && response.error?.code === Mcp.paymentRequiredCode;
        },
        getChallenges(response) {
            if (!('error' in response) || !response.error)
                throw new Error('Response is not an error.');
            const challenges = response.error.data?.challenges;
            if (!challenges?.length)
                throw new Error('No challenge in error response.');
            return challenges;
        },
        getChallenge(response) {
            if (!('error' in response) || !response.error)
                throw new Error('Response is not an error.');
            const challenge = response.error.data?.challenges[0];
            if (!challenge)
                throw new Error('No challenge in error response.');
            return challenge;
        },
        setCredential(request, credential) {
            const parsed = Credential.deserialize(credential);
            return {
                ...request,
                params: {
                    ...request.params,
                    _meta: {
                        ...request.params?._meta,
                        [Mcp.credentialMetaKey]: parsed,
                    },
                },
            };
        },
    });
}
//# sourceMappingURL=Transport.js.map