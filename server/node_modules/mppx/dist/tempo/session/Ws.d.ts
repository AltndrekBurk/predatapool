import * as ChannelStore from './ChannelStore.js';
import type { SessionController } from './Sse.js';
import type { NeedVoucherEvent, SessionReceipt } from './Types.js';
export type { SessionController } from './Sse.js';
export type SessionRouteResult = {
    status: 402;
    challenge: Response;
} | {
    status: 200;
    withReceipt(response?: Response): Response;
};
export type SessionRoute = (request: Request) => Promise<SessionRouteResult>;
export type Socket = {
    close(code?: number, reason?: string): unknown;
    send(data: string): unknown;
    addEventListener?: (type: 'close' | 'error' | 'message', listener: ((event: any) => void) | {
        handleEvent(event: any): void;
    }) => unknown;
    removeEventListener?: (type: 'close' | 'error' | 'message', listener: ((event: any) => void) | {
        handleEvent(event: any): void;
    }) => unknown;
    on?: (type: 'close' | 'error' | 'message', listener: (...args: any[]) => void) => unknown;
    off?: (type: 'close' | 'error' | 'message', listener: (...args: any[]) => void) => unknown;
};
export type Message = {
    mpp: 'authorization';
    authorization: string;
} | {
    mpp: 'message';
    data: string;
} | {
    mpp: 'payment-close-request';
} | {
    mpp: 'payment-close-ready';
    data: SessionReceipt;
} | {
    mpp: 'payment-error';
    status: number;
    message: string;
} | {
    mpp: 'payment-need-voucher';
    data: NeedVoucherEvent;
} | {
    mpp: 'payment-receipt';
    data: SessionReceipt;
};
export declare function formatAuthorizationMessage(authorization: string): string;
export declare function formatApplicationMessage(data: string): string;
export declare function formatCloseRequestMessage(): string;
export declare function formatCloseReadyMessage(receipt: SessionReceipt): string;
export declare function formatNeedVoucherMessage(params: NeedVoucherEvent): string;
export declare function formatReceiptMessage(receipt: SessionReceipt): string;
export declare function formatErrorMessage(parameters: {
    message: string;
    status: number;
}): string;
export declare function parseMessage(raw: string): Message | null;
/**
 * Bridge a WebSocket connection to a Tempo session payment flow.
 *
 * Credential verification is performed by routing each in-band authorization
 * frame through `route` as a **synthetic `POST` request** that carries only
 * the `Authorization` header. The synthetic request does not include cookies,
 * bodies, query parameters, or other headers from the original WebSocket
 * upgrade request. Do not wrap `route` with middleware that depends on
 * HTTP-specific context beyond the `Authorization` header.
 */
export declare function serve(options: serve.Options): Promise<void>;
export declare namespace serve {
    type Options = {
        /** Expected per-tick amount in raw units. When set, credentials whose
         *  challenge `request.amount` does not match are rejected. Use this to
         *  pin the price when the route is backed by `Mppx.compose()` with
         *  multiple offers — otherwise a client can select the cheapest offer
         *  and still receive the same stream. */
        amount?: string | undefined;
        generate: AsyncIterable<string> | ((stream: SessionController) => AsyncIterable<string>);
        pollIntervalMs?: number | undefined;
        /** Payment route handler. Receives synthetic `POST` requests with only
         *  the `Authorization` header — no cookies, bodies, or upgrade headers. */
        route: SessionRoute;
        socket: Socket;
        store: ChannelStore.ChannelStore | import('../../Store.js').Store;
        url: string | URL;
    };
}
//# sourceMappingURL=Ws.d.ts.map