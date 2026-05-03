import * as Credential from '../../Credential.js';
import * as ChannelStore from './ChannelStore.js';
import { deserializeSessionReceipt } from './Receipt.js';
import { createSessionReceipt } from './Receipt.js';
export function formatAuthorizationMessage(authorization) {
    return JSON.stringify({ mpp: 'authorization', authorization });
}
export function formatApplicationMessage(data) {
    return JSON.stringify({ mpp: 'message', data });
}
export function formatCloseRequestMessage() {
    return JSON.stringify({ mpp: 'payment-close-request' });
}
export function formatCloseReadyMessage(receipt) {
    return JSON.stringify({ mpp: 'payment-close-ready', data: receipt });
}
export function formatNeedVoucherMessage(params) {
    return JSON.stringify({ mpp: 'payment-need-voucher', data: params });
}
export function formatReceiptMessage(receipt) {
    return JSON.stringify({ mpp: 'payment-receipt', data: receipt });
}
export function formatErrorMessage(parameters) {
    return JSON.stringify({ mpp: 'payment-error', ...parameters });
}
export function parseMessage(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed.mpp === 'authorization' && typeof parsed.authorization === 'string') {
            return { mpp: 'authorization', authorization: parsed.authorization };
        }
        if (parsed.mpp === 'message' && typeof parsed.data === 'string') {
            return { mpp: 'message', data: parsed.data };
        }
        if (parsed.mpp === 'payment-close-request') {
            return { mpp: 'payment-close-request' };
        }
        if (parsed.mpp === 'payment-close-ready' && isSessionReceipt(parsed.data)) {
            return { mpp: 'payment-close-ready', data: parsed.data };
        }
        if (parsed.mpp === 'payment-error' &&
            typeof parsed.status === 'number' &&
            typeof parsed.message === 'string') {
            return { mpp: 'payment-error', status: parsed.status, message: parsed.message };
        }
        if (parsed.mpp === 'payment-need-voucher' && isNeedVoucherEvent(parsed.data)) {
            return { mpp: 'payment-need-voucher', data: parsed.data };
        }
        if (parsed.mpp === 'payment-receipt' && isSessionReceipt(parsed.data)) {
            return { mpp: 'payment-receipt', data: parsed.data };
        }
        return null;
    }
    catch {
        return null;
    }
}
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
export async function serve(options) {
    const { amount: expectedAmount, generate, pollIntervalMs = 100, route, socket, store: rawStore, url, } = options;
    const store = 'getChannel' in rawStore ? rawStore : ChannelStore.fromStore(rawStore);
    const requestUrl = normalizeHttpUrl(url);
    const maxQueuedPaymentMessages = 32;
    const abortController = new AbortController();
    let closed = false;
    let closeReadySent = false;
    let closeRequestHandled = false;
    let closeRequested = false;
    let streamStarted = false;
    let streamTask = null;
    let streamContext = null;
    let action = Promise.resolve();
    let queuedActions = 0;
    const close = async (code = 1000, reason) => {
        if (closed)
            return;
        closed = true;
        abortController.abort();
        unsubscribe();
        await Promise.resolve(socket.close(code, reason));
    };
    const sendCloseReady = async () => {
        if (closeReadySent || !streamContext || closed)
            return;
        closeReadySent = true;
        const channel = await store.getChannel(streamContext.channelId);
        if (!channel)
            throw new Error('channel not found');
        const receipt = createSessionReceipt({
            challengeId: streamContext.challengeId,
            channelId: streamContext.channelId,
            acceptedCumulative: channel.highestVoucherAmount,
            spent: channel.spent,
            units: channel.units,
        });
        await send(socket, formatCloseReadyMessage(receipt));
    };
    const runStream = async (context) => {
        let reservedAmount = 0n;
        let reservedUnits = 0;
        const charge = () => reserveChargeOrWait({
            amount: context.tickCost,
            channelId: context.channelId,
            reservedAmount,
            emit: (message) => send(socket, message),
            pollIntervalMs,
            signal: abortController.signal,
            store,
        }).then(() => {
            reservedAmount += context.tickCost;
            reservedUnits += 1;
        });
        const iterable = typeof generate === 'function' ? generate({ charge }) : generate;
        try {
            for await (const value of iterable) {
                if (abortController.signal.aborted)
                    break;
                if (typeof generate !== 'function')
                    await charge();
                await commitReservedCharges({
                    store,
                    channelId: context.channelId,
                    amount: reservedAmount,
                    units: reservedUnits,
                });
                reservedAmount = 0n;
                reservedUnits = 0;
                await send(socket, formatApplicationMessage(value));
            }
            if (!abortController.signal.aborted)
                await sendCloseReady();
        }
        catch (error) {
            if (!abortController.signal.aborted) {
                await send(socket, formatErrorMessage({
                    message: error instanceof Error ? error.message : 'websocket session failed',
                    status: 500,
                }));
                await close(1011, 'websocket session failed');
            }
        }
        finally {
            streamTask = null;
        }
    };
    const requestClose = async () => {
        if (closed)
            return;
        if (closeRequestHandled)
            return;
        closeRequestHandled = true;
        closeRequested = true;
        abortController.abort();
        await streamTask?.catch(() => { });
        await sendCloseReady();
    };
    const processAuthorization = async (authorization) => {
        if (closed)
            return;
        const credential = Credential.deserialize(authorization);
        const payload = credential.payload;
        if (payload.action === 'close')
            closeRequested = true;
        if (expectedAmount && credential.challenge.request.amount !== expectedAmount) {
            await send(socket, formatErrorMessage({
                message: 'credential amount does not match this endpoint',
                status: 402,
            }));
            await close(1008, 'credential amount does not match this endpoint');
            return;
        }
        const result = await route(new Request(requestUrl, {
            method: 'POST',
            headers: { Authorization: authorization },
        }));
        if (result.status === 402) {
            const response = result.challenge;
            const message = (await response.text().catch(() => '')) ||
                response.statusText ||
                'payment verification failed';
            await send(socket, formatErrorMessage({ message, status: response.status }));
            await close(1008, message);
            return;
        }
        const response = result.withReceipt(new Response(null, { status: 204 }));
        const receiptHeader = response.headers.get('Payment-Receipt');
        if (!receiptHeader) {
            throw new Error('management response missing Payment-Receipt header');
        }
        const receipt = deserializeSessionReceipt(receiptHeader);
        await send(socket, formatReceiptMessage(receipt));
        if (payload.action === 'close') {
            await close(1000, 'payment session closed');
            return;
        }
        if (payload.action === 'topUp')
            return;
        if (streamStarted || closeRequested)
            return;
        streamStarted = true;
        streamContext = {
            challengeId: credential.challenge.id,
            channelId: payload.channelId,
            tickCost: BigInt(credential.challenge.request.amount),
        };
        // Defer the first application frame until after the client receives the
        // auth receipt and has a chance to install its own message listeners.
        setTimeout(() => {
            if (closeRequested || closed || !streamContext)
                return;
            streamTask = runStream(streamContext);
        }, 0);
    };
    const onMessage = (payload) => {
        if (closed)
            return;
        const raw = toText(payload);
        if (!raw)
            return;
        const message = parseMessage(raw);
        if (!message)
            return;
        if (message.mpp === 'payment-close-request') {
            closeRequested = true;
            abortController.abort();
        }
        const work = message.mpp === 'authorization'
            ? () => processAuthorization(message.authorization)
            : message.mpp === 'payment-close-request'
                ? () => requestClose()
                : null;
        if (!work)
            return;
        if (queuedActions >= maxQueuedPaymentMessages) {
            void send(socket, formatErrorMessage({
                message: 'too many queued payment messages',
                status: 429,
            })).catch(() => { });
            void close(1008, 'too many queued payment messages');
            return;
        }
        queuedActions++;
        action = action
            .then(async () => {
            try {
                if (closed)
                    return;
                await work();
            }
            finally {
                queuedActions--;
            }
        })
            .catch(async (error) => {
            if (!closed) {
                await send(socket, formatErrorMessage({
                    message: error instanceof Error ? error.message : 'invalid payment message',
                    status: 400,
                }));
                await close(1008, 'invalid payment message');
            }
        });
    };
    const onClose = () => {
        if (closed)
            return;
        closed = true;
        abortController.abort();
        unsubscribe();
    };
    const unsubscribe = subscribe(socket, {
        close: onClose,
        error: onClose,
        message: onMessage,
    });
}
function normalizeHttpUrl(value) {
    const url = new URL(value.toString());
    if (url.protocol === 'ws:')
        url.protocol = 'http:';
    if (url.protocol === 'wss:')
        url.protocol = 'https:';
    return url.toString();
}
async function reserveChargeOrWait(options) {
    const { amount, channelId, emit, pollIntervalMs, reservedAmount, signal, store } = options;
    let channel = await store.getChannel(channelId);
    if (!channel)
        throw new Error('channel not found');
    const hasHeadroom = (state) => state.highestVoucherAmount - state.spent - reservedAmount >= amount;
    if (hasHeadroom(channel))
        return;
    await emit(formatNeedVoucherMessage({
        channelId,
        requiredCumulative: (channel.spent + reservedAmount + amount).toString(),
        acceptedCumulative: channel.highestVoucherAmount.toString(),
        deposit: channel.deposit.toString(),
    }));
    while (!hasHeadroom(channel)) {
        await waitForUpdate(store, channelId, pollIntervalMs, signal);
        channel = await store.getChannel(channelId);
        if (!channel)
            throw new Error('channel not found');
    }
}
async function commitReservedCharges(options) {
    const { amount, channelId, units, store } = options;
    if (amount === 0n || units === 0)
        return;
    let committed = false;
    const channel = await store.updateChannel(channelId, (current) => {
        if (!current)
            return null;
        if (current.finalized)
            return current;
        if (current.highestVoucherAmount - current.spent < amount)
            return current;
        committed = true;
        return {
            ...current,
            spent: current.spent + amount,
            units: current.units + units,
        };
    });
    if (!channel)
        throw new Error('channel not found');
    if (!committed)
        throw new Error('reserved voucher coverage is no longer available');
}
async function waitForUpdate(store, channelId, pollIntervalMs, signal) {
    throwIfAborted(signal);
    if (store.waitForUpdate) {
        await Promise.race([store.waitForUpdate(channelId), onceAborted(signal)]);
        return;
    }
    await sleep(pollIntervalMs, signal);
}
function subscribe(socket, handlers) {
    if (socket.addEventListener && socket.removeEventListener) {
        const onMessage = (event) => {
            const data = event.data;
            handlers.message(data);
        };
        socket.addEventListener('message', onMessage);
        socket.addEventListener('close', handlers.close);
        socket.addEventListener('error', handlers.error);
        return () => {
            socket.removeEventListener?.('message', onMessage);
            socket.removeEventListener?.('close', handlers.close);
            socket.removeEventListener?.('error', handlers.error);
        };
    }
    if (socket.on && socket.off) {
        const onMessage = (data) => handlers.message(data);
        socket.on('message', onMessage);
        socket.on('close', handlers.close);
        socket.on('error', handlers.error);
        return () => {
            socket.off?.('message', onMessage);
            socket.off?.('close', handlers.close);
            socket.off?.('error', handlers.error);
        };
    }
    throw new Error('unsupported websocket implementation');
}
async function send(socket, data) {
    await Promise.resolve(socket.send(data));
}
function toText(value) {
    if (typeof value === 'string')
        return value;
    if (value instanceof ArrayBuffer)
        return new TextDecoder().decode(value);
    if (ArrayBuffer.isView(value)) {
        return new TextDecoder().decode(value);
    }
    return null;
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal.reason ?? new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
function onceAborted(signal) {
    return new Promise((_, reject) => {
        if (signal.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
        }
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
            once: true,
        });
    });
}
function throwIfAborted(signal) {
    if (signal.aborted)
        throw signal.reason ?? new Error('aborted');
}
function isSessionReceipt(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return typeof v.challengeId === 'string' && typeof v.channelId === 'string';
}
function isNeedVoucherEvent(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return typeof v.channelId === 'string' && typeof v.requiredCumulative === 'string';
}
//# sourceMappingURL=Ws.js.map