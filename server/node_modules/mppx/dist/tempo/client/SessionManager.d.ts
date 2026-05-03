import type { Hex } from 'ox';
import { type Address } from 'viem';
import * as Challenge from '../../Challenge.js';
import type * as Account from '../../viem/Account.js';
import type * as Client from '../../viem/Client.js';
import type { SessionReceipt } from '../session/Types.js';
type WebSocketConstructor = {
    new (url: string | URL, protocols?: string | string[]): WebSocket;
};
export type SessionManager = {
    readonly channelId: Hex.Hex | undefined;
    readonly cumulative: bigint;
    readonly opened: boolean;
    open(options?: {
        deposit?: bigint;
    }): Promise<void>;
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<PaymentResponse>;
    sse(input: RequestInfo | URL, init?: RequestInit & {
        onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
        signal?: AbortSignal | undefined;
    }): Promise<AsyncIterable<string>>;
    ws(input: string | URL, init?: {
        onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
        protocols?: string | string[] | undefined;
        signal?: AbortSignal | undefined;
    }): Promise<WebSocket>;
    close(): Promise<SessionReceipt | undefined>;
};
export type PaymentResponse = Response & {
    receipt: SessionReceipt | null;
    challenge: Challenge.Challenge | null;
    channelId: Hex.Hex | null;
    cumulative: bigint;
};
/**
 * Creates a session manager that handles the full client payment lifecycle:
 * channel open, incremental vouchers, SSE streaming, and channel close.
 *
 * Internally delegates to the `session()` method for all
 * channel state management and credential creation, and to `Fetch.from`
 * for the 402 challenge/retry flow.
 *
 * ## Session resumption
 *
 * All channel state is held **in memory**. If the client process restarts,
 * the session is lost and a new on-chain channel will be opened on the next
 * request — the previous channel's deposit is orphaned until manually closed.
 *
 * When the server includes a `channelId` in the 402 challenge `methodDetails`,
 * the client will attempt to recover the channel by reading its on-chain state
 * via `getOnChainChannel()`. If the channel has a positive deposit and is not
 * finalized, it resumes from the on-chain settled amount.
 */
export declare function sessionManager(parameters: sessionManager.Parameters): SessionManager;
export declare namespace sessionManager {
    type Parameters = Account.getResolver.Parameters & Client.getResolver.Parameters & {
        /** Address authorized to sign vouchers. Defaults to the account address. */
        authorizedSigner?: Address | undefined;
        /** Viem client instance. Shorthand for `getClient: () => client`. */
        client?: import('viem').Client | undefined;
        /** Token decimals used to convert `maxDeposit` to raw units. Defaults to `6`. */
        decimals?: number | undefined;
        /** Escrow contract address. */
        escrowContract?: Address | undefined;
        fetch?: typeof globalThis.fetch | undefined;
        /** Maximum deposit in human-readable units (e.g. `'10'` for 10 tokens). Converted to raw units via `decimals`. */
        maxDeposit?: string | undefined;
        /** Optional websocket constructor for runtimes without a global WebSocket. */
        webSocket?: WebSocketConstructor | undefined;
    };
}
export {};
//# sourceMappingURL=SessionManager.d.ts.map