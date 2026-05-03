export type StoreItemMap = Record<string, unknown>;
/**
 * Describes the outcome of an atomic {@link Update} callback.
 *
 * - `noop` — leave the stored value unchanged.
 * - `set`  — write `value` for the key.
 * - `delete` — remove the key.
 *
 * Every variant carries a `result` that is forwarded to the caller.
 */
export type Change<value, result> = {
    op: 'noop';
    result: result;
} | {
    op: 'set';
    value: value;
    result: result;
} | {
    op: 'delete';
    result: result;
};
/**
 * Atomic read-modify-write for a single key.
 *
 * `fn` receives the current value (or `null`) and returns a {@link Change}
 * describing the write to perform. Implementations may retry `fn`, so it
 * must be synchronous and free of side effects.
 */
export type Update<itemMap extends StoreItemMap = StoreItemMap> = <key extends keyof itemMap & string, result>(key: key, fn: (current: itemMap[key] | null) => Change<itemMap[key], result>) => Promise<result>;
/** Base key-value actions available on every {@link Store}. */
export type StoreActions<itemMap extends StoreItemMap = StoreItemMap> = {
    get: <key extends keyof itemMap & string>(key: key) => Promise<itemMap[key] | null>;
    put: <key extends keyof itemMap & string>(key: key, value: itemMap[key]) => Promise<void>;
    delete: <key extends keyof itemMap & string>(key: key) => Promise<void>;
};
/** Atomic actions that can be provided via the `extended` slot. */
export type AtomicActions<itemMap extends StoreItemMap = StoreItemMap> = {
    update: Update<itemMap>;
};
/**
 * Async key-value store.
 *
 * The second generic `extended` accumulates additional capabilities
 * (like {@link AtomicActions}) without structural patching.
 */
export type Store<itemMap extends StoreItemMap = StoreItemMap, extended extends Record<string, unknown> | undefined = undefined> = StoreActions<itemMap> & (extended extends Record<string, unknown> ? extended : unknown);
/**
 * A {@link Store} whose atomic {@link Update} method is guaranteed to exist.
 *
 * Use this when atomicity is required (e.g., replay protection, channel
 * deductions). Factory functions return `AtomicStore` when the backing
 * adapter provides an `update` implementation.
 *
 * Equivalent to `Store<itemMap, AtomicActions<itemMap>>`.
 */
export type AtomicStore<itemMap extends StoreItemMap = StoreItemMap> = Store<itemMap, AtomicActions<itemMap>>;
/** Creates a {@link Store} from an existing implementation. */
export declare function from<store extends Store>(store: store): store;
export declare function from<store extends AtomicStore>(store: store): store;
/** Wraps a Cloudflare KV namespace. */
export declare function cloudflare(kv: cloudflare.AtomicParameters): AtomicStore;
export declare function cloudflare(kv: cloudflare.Parameters): Store;
export declare namespace cloudflare {
    type Parameters = {
        get: (key: string) => Promise<unknown>;
        put: (key: string, value: string) => Promise<void>;
        delete: (key: string) => Promise<void>;
        update?: <result>(key: string, fn: (current: string | null) => Change<string, result>) => Promise<result>;
    };
    type AtomicParameters = Omit<Parameters, 'update'> & {
        update: NonNullable<Parameters['update']>;
    };
}
/** In-memory store backed by a `Map`. JSON-roundtrips values to match production behavior. */
export declare function memory(): AtomicStore;
/** Wraps a standard Redis client (ioredis, node-redis, Valkey). */
export declare function redis(client: redis.AtomicParameters): AtomicStore;
export declare function redis(client: redis.Parameters): Store;
export declare namespace redis {
    type Parameters = {
        get: (key: string) => Promise<string | null>;
        set: (key: string, value: string) => Promise<unknown>;
        del: (key: string) => Promise<unknown>;
        update?: <result>(key: string, fn: (current: string | null) => Change<string, result>) => Promise<result>;
    };
    type AtomicParameters = Omit<Parameters, 'update'> & {
        update: NonNullable<Parameters['update']>;
    };
}
/** Wraps an Upstash Redis instance (e.g. Vercel KV). */
export declare function upstash(redis: upstash.AtomicParameters): AtomicStore;
export declare function upstash(redis: upstash.Parameters): Store;
export declare namespace upstash {
    type Parameters = {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<unknown>;
        del: (key: string) => Promise<unknown>;
        update?: <result>(key: string, fn: (current: unknown | null) => Change<unknown, result>) => Promise<result>;
    };
    type AtomicParameters = Omit<Parameters, 'update'> & {
        update: NonNullable<Parameters['update']>;
    };
}
//# sourceMappingURL=Store.d.ts.map