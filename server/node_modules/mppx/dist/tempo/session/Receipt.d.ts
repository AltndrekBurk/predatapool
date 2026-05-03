import type { Hex } from 'viem';
import type { SessionReceipt } from './Types.js';
/**
 * Create a session receipt.
 */
export declare function createSessionReceipt(params: {
    challengeId: string;
    channelId: Hex;
    acceptedCumulative: bigint;
    spent: bigint;
    units?: number | undefined;
    txHash?: Hex | undefined;
}): SessionReceipt;
/**
 * Serialize a session receipt to the Payment-Receipt header format.
 */
export declare function serializeSessionReceipt(receipt: SessionReceipt): string;
/**
 * Deserialize a Payment-Receipt header value to a session receipt.
 */
export declare function deserializeSessionReceipt(encoded: string): SessionReceipt;
//# sourceMappingURL=Receipt.d.ts.map