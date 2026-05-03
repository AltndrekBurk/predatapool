import * as Challenge from '../Challenge.js';
import * as Mcp from '../Mcp.js';
/**
 * Client-side transport adapter.
 *
 * Abstracts how challenges are received and credentials are sent
 * across different transport protocols (HTTP, MCP, etc.).
 */
export type Transport<in out request = unknown, in out response = unknown> = {
    /** Transport name for identification. */
    name: string;
    /** Checks if a response indicates payment is required. */
    isPaymentRequired: (response: response) => boolean;
    /** Extracts all challenges from a payment-required response, when the transport supports multiple offers. */
    getChallenges?: (response: response) => Challenge.Challenge[];
    /** Extracts the challenge from a payment-required response. */
    getChallenge: (response: response) => Challenge.Challenge;
    /** Attaches a credential to a request. */
    setCredential: (request: request, credential: string) => request;
};
export type AnyTransport = Transport<any, any>;
/** Extracts the response type from a transport. */
export type ResponseOf<transport extends Transport> = transport extends Transport<any, infer response> ? response : never;
/** Extracts the request type from a transport. */
export type RequestOf<transport extends Transport> = transport extends Transport<infer request, any> ? request : never;
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
export declare function from<request, response>(transport: Transport<request, response>): Transport<request, response>;
/**
 * HTTP transport for client-side payment handling.
 *
 * - Detects payment required via 402 status
 * - Extracts challenges from `WWW-Authenticate` header
 * - Sends credentials via `Authorization` header
 */
export declare function http(): Transport<RequestInit, Response>;
/**
 * MCP transport for client-side payment handling.
 *
 * - Detects payment required via error code -32042
 * - Extracts challenges from `error.data.challenges[0]`
 * - Sends credentials via `_meta["org.paymentauth/credential"]`
 */
export declare function mcp(): Transport<Mcp.Request, Mcp.Response>;
//# sourceMappingURL=Transport.d.ts.map