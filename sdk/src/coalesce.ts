/**
 * Singleflight — Cloudflare-style request coalescing at the caller.
 *
 * When N callers in the same process invoke `do(key, fn)` concurrently for
 * the same key, only the first triggers `fn()`. All others receive the same
 * in-flight Promise. On settle (success OR failure) the entry is cleared in
 * `finally`, so a subsequent caller starts fresh — failures are never cached
 * past the call that produced them.
 *
 * This is the real "fetch once, share N ways" semantic Cloudflare gives web
 * traffic, applied to paid M2M data requests. Server-side persistence (the
 * pool's encrypted cache) composes naturally on top of this client-side
 * coalescing.
 *
 * Map size bound: at most (number of distinct concurrent keys) entries; no
 * LRU needed. `Singleflight` does not own its own timeout — the wrapped
 * `fn` should manage its own abort/timeout.
 */
export class Singleflight<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  /**
   * Returns the shared in-flight Promise for `key`, creating one by invoking
   * `fn` if none exists. The entry is removed when the Promise settles
   * (resolve OR reject) — concurrent retries after settle are independent.
   */
  do(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  /** Number of distinct keys currently in flight. Informational; for tests. */
  get size(): number {
    return this.inflight.size;
  }
}
