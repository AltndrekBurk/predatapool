import { Base64 } from 'ox';
/**
 * Create a session receipt.
 */
export function createSessionReceipt(params) {
    return {
        method: 'tempo',
        intent: 'session',
        status: 'success',
        timestamp: new Date().toISOString(),
        reference: params.channelId,
        challengeId: params.challengeId,
        channelId: params.channelId,
        acceptedCumulative: params.acceptedCumulative.toString(),
        spent: params.spent.toString(),
        ...(params.units !== undefined && { units: params.units }),
        ...(params.txHash !== undefined && { txHash: params.txHash }),
    };
}
/**
 * Serialize a session receipt to the Payment-Receipt header format.
 */
export function serializeSessionReceipt(receipt) {
    const json = JSON.stringify(receipt);
    return Base64.fromString(json, { pad: false, url: true });
}
/**
 * Deserialize a Payment-Receipt header value to a session receipt.
 */
export function deserializeSessionReceipt(encoded) {
    const json = Base64.toString(encoded);
    return JSON.parse(json);
}
//# sourceMappingURL=Receipt.js.map