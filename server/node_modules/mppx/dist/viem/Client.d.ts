import { type Chain, type Client } from 'viem';
import type { MaybePromise } from '../internal/types.js';
export declare function getResolver(parameters: getResolver.Parameters & {
    /** Default chain to use if not provided. */
    chain?: Chain | undefined;
    /** Fee payer relay URL. When set, the transport is wrapped with `withFeePayer`. */
    feePayerUrl?: string | undefined;
    /** RPC URLs keyed by chain ID. */
    rpcUrl?: ({
        [chainId: number]: string;
    } & object) | undefined;
}): (parameters: {
    chainId?: number | undefined;
}) => MaybePromise<Client>;
export declare namespace getResolver {
    type Parameters = {
        /** Function that returns a client for the given chain ID. */
        getClient?: ((parameters: {
            chainId?: number | undefined;
        }) => MaybePromise<Client>) | undefined;
    };
}
//# sourceMappingURL=Client.d.ts.map