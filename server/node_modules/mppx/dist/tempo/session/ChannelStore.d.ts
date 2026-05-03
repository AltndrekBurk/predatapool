import type { Address, Hex } from 'viem';
import type * as Store from '../../Store.js';
import type { SignedVoucher } from './Types.js';
/**
 * State for an on-chain payment channel, including per-session accounting.
 *
 * Tracks the channel's identity, on-chain balance, the highest voucher
 * the server has accepted, and the current session's spend counters.
 * A channel is created when a payer opens an escrow on-chain and persists
 * until the channel is finalized (closed/settled).
 *
 * One channel = one session. The client owns the key and can't race with
 * itself, so concurrent session support is unnecessary.
 *
 * Monotonicity invariants (enforced by update callbacks):
 * - `highestVoucherAmount` only increases
 * - `settledOnChain` only increases
 * - `deposit` reflects the latest on-chain value
 */
export interface State {
    /** Address authorized to sign vouchers on behalf of the payer. */
    authorizedSigner: Address;
    /** Chain ID the channel was opened on. */
    chainId: number;
    /** Escrow contract address the channel was opened on. */
    escrowContract: Address;
    /** Unique identifier for this payment channel. */
    channelId: Hex;
    /** On-chain timestamp when a force-close was requested (0n if not requested). */
    closeRequestedAt: bigint;
    /** ISO 8601 timestamp when the channel was created. */
    createdAt: string;
    /** Current on-chain deposit in the escrow contract. */
    deposit: bigint;
    /** Whether the channel has been finalized (closed) on-chain. */
    finalized: boolean;
    /** The signed voucher corresponding to `highestVoucherAmount`. */
    highestVoucher: SignedVoucher | null;
    /** Highest cumulative voucher amount accepted by the server. */
    highestVoucherAmount: bigint;
    /** Address of the payment recipient. */
    payee: Address;
    /** Address of the payment sender. */
    payer: Address;
    /** Cumulative amount settled on-chain so far. */
    settledOnChain: bigint;
    /** Cumulative amount spent (charged) against this channel's current session. */
    spent: bigint;
    /** Token contract address used for payments. */
    token: Address;
    /** Number of charge operations (API requests) fulfilled in the current session. */
    units: number;
}
/**
 * Internal store interface for channel state persistence.
 *
 * ## Atomicity contract
 *
 * The `updateChannel` method uses an atomic read-modify-write callback.
 * The callback receives the current state (or `null` if none exists), and
 * returns the next state (or `null` to delete). Implementations must
 * guarantee that no concurrent mutation occurs between reading `current`
 * and writing the return value.
 *
 * Callbacks should be synchronous and deterministic. When a `ChannelStore`
 * is backed by `Store.update()`, adapters may retry them internally.
 *
 * Backends implement this via their native mechanisms:
 * - **In-memory / JS single-thread**: Synchronous callback execution
 * - **Durable Objects**: Single-threaded execution model
 * - **D1 / SQL**: Database transactions
 */
export type ChannelStore = {
    getChannel(channelId: Hex): Promise<State | null>;
    /**
     * Atomic read-modify-write for channel state.
     * Return `null` from `fn` to delete the channel.
     */
    updateChannel(channelId: Hex, fn: (current: State | null) => State | null): Promise<State | null>;
    /**
     * Wait for the next update to a channel.
     *
     * Returns a `Promise` that resolves once `updateChannel` is called for
     * `channelId`. Implementations should resolve immediately if the channel
     * was updated between the call to `waitForUpdate` and the `Promise`
     * being awaited.
     *
     * When not implemented, callers fall back to polling.
     */
    waitForUpdate?(channelId: Hex): Promise<void>;
    /**
     * Atomic read-modify-write that returns the callback's `result` directly.
     *
     * Used by {@link deductFromChannel} to atomically compute the deduction
     * outcome. When backed by `Store.update()`, this delegates to the store's
     * native atomic primitive.
     */
    updateChannelResult?<result>(channelId: Hex, fn: (current: State | null) => Store.Change<State, result>): Promise<result>;
};
export type DeductResult = {
    ok: true;
    channel: State;
} | {
    ok: false;
    channel: State;
};
export declare function normalizeChannelId(channelId: Hex): Hex;
/**
 * Atomically deduct `amount` from a channel's available balance.
 *
 * Returns `{ ok: true, channel }` if the deduction succeeded, or
 * `{ ok: false, channel }` with the unchanged state if balance is
 * insufficient. Throws if the channel does not exist.
 */
export declare function deductFromChannel(store: ChannelStore, channelId: Hex, amount: bigint): Promise<DeductResult>;
export declare function fromStore(store: Store.Store | Store.AtomicStore): ChannelStore;
//# sourceMappingURL=ChannelStore.d.ts.map