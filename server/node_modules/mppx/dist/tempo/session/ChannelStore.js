export function normalizeChannelId(channelId) {
    return channelId.toLowerCase();
}
function normalizeState(channelId, state) {
    return state.channelId === channelId ? state : { ...state, channelId };
}
function normalizeMaybeState(channelId, state) {
    return state ? normalizeState(channelId, state) : null;
}
/**
 * Atomically deduct `amount` from a channel's available balance.
 *
 * Returns `{ ok: true, channel }` if the deduction succeeded, or
 * `{ ok: false, channel }` with the unchanged state if balance is
 * insufficient. Throws if the channel does not exist.
 */
export async function deductFromChannel(store, channelId, amount) {
    if (store.updateChannelResult) {
        const result = await store.updateChannelResult(channelId, (current) => {
            if (!current)
                return { op: 'noop', result: null };
            if (current.finalized)
                return { op: 'noop', result: { ok: false, channel: current } };
            if (current.closeRequestedAt !== 0n)
                return { op: 'noop', result: { ok: false, channel: current } };
            if (current.highestVoucherAmount - current.spent >= amount) {
                const next = { ...current, spent: current.spent + amount, units: current.units + 1 };
                return { op: 'set', value: next, result: { ok: true, channel: next } };
            }
            return { op: 'noop', result: { ok: false, channel: current } };
        });
        if (!result)
            throw new Error('channel not found');
        return result;
    }
    let result = null;
    const channel = await store.updateChannel(channelId, (current) => {
        if (!current)
            return null;
        if (current.finalized) {
            result = { ok: false, channel: current };
            return current;
        }
        if (current.closeRequestedAt !== 0n) {
            result = { ok: false, channel: current };
            return current;
        }
        if (current.highestVoucherAmount - current.spent >= amount) {
            const next = { ...current, spent: current.spent + amount, units: current.units + 1 };
            result = { ok: true, channel: next };
            return next;
        }
        result = { ok: false, channel: current };
        return current;
    });
    if (!channel)
        throw new Error('channel not found');
    return result ?? { ok: false, channel };
}
/**
 * Wraps a generic {@link Store} into the internal {@link Store}
 * interface used by server handlers and the SSE metering loop.
 *
 * Provides `waitForUpdate` notifications so the SSE `chargeOrWait` loop
 * can wake up without polling.
 *
 * ## Atomicity
 *
 * Mutations use `get` → `fn` → `set` guarded by a per-key in-process
 * mutex. This serializes concurrent `updateChannel` calls within a
 * single JS runtime but does **not** protect against races across
 * multiple processes or instances.
 *
 * Backends that need true atomicity (e.g., Durable Objects, D1)
 * should implement {@link Store} directly.
 */
const storeCache = new WeakMap();
export function fromStore(store) {
    const cached = storeCache.get(store);
    if (cached)
        return cached;
    const atomicUpdate = 'update' in store ? store.update : undefined;
    const waiters = new Map();
    const locks = new Map();
    function notify(channelId) {
        const set = waiters.get(channelId);
        if (!set)
            return;
        for (const resolve of set)
            resolve();
        waiters.delete(channelId);
    }
    async function update(channelId, fn) {
        return updateResult(channelId, (current) => {
            const next = fn(current);
            if (next)
                return { op: 'set', value: next, result: next };
            return { op: 'delete', result: null };
        });
    }
    async function updateResult(channelId, fn) {
        const normalizedChannelId = normalizeChannelId(channelId);
        let change;
        if (atomicUpdate) {
            const result = await atomicUpdate(normalizedChannelId, (current) => {
                change = fn(normalizeMaybeState(normalizedChannelId, current ?? null));
                if (change.op === 'set') {
                    change = {
                        ...change,
                        value: normalizeState(normalizedChannelId, change.value),
                    };
                }
                if (change.op !== 'set')
                    return change;
                return { ...change, value: change.value };
            });
            if (change?.op !== 'noop')
                notify(normalizedChannelId);
            return result;
        }
        while (locks.has(normalizedChannelId))
            await locks.get(normalizedChannelId);
        let release;
        locks.set(normalizedChannelId, new Promise((r) => {
            release = r;
        }));
        try {
            const current = normalizeMaybeState(normalizedChannelId, (await store.get(normalizedChannelId)));
            change = fn(current);
            if (change.op === 'set') {
                change = {
                    ...change,
                    value: normalizeState(normalizedChannelId, change.value),
                };
                await store.put(normalizedChannelId, change.value);
            }
            if (change.op === 'delete')
                await store.delete(normalizedChannelId);
            if (change.op !== 'noop')
                notify(normalizedChannelId);
            return change.result;
        }
        finally {
            locks.delete(normalizedChannelId);
            release();
        }
    }
    const cs = {
        async getChannel(channelId) {
            const normalizedChannelId = normalizeChannelId(channelId);
            return normalizeMaybeState(normalizedChannelId, (await store.get(normalizedChannelId)));
        },
        async updateChannel(channelId, fn) {
            return update(channelId, fn);
        },
        waitForUpdate(channelId) {
            return new Promise((resolve) => {
                const normalizedChannelId = normalizeChannelId(channelId);
                let set = waiters.get(normalizedChannelId);
                if (!set) {
                    set = new Set();
                    waiters.set(normalizedChannelId, set);
                }
                set.add(resolve);
            });
        },
    };
    cs.updateChannelResult = updateResult;
    storeCache.set(store, cs);
    return cs;
}
//# sourceMappingURL=ChannelStore.js.map