import type { Account, Address } from 'viem';
/**
 * Resolves a recipient address and optional fee payer from flexible input parameters.
 *
 * Accepts either `account` or `recipient` as the parameter name. When the value
 * is an `Account`, its address is extracted. If `feePayer` is `true`, the
 * account also acts as the fee payer. Alternatively, a separate `Account`
 * can be provided as the fee payer, or a URL string pointing to a fee payer
 * relay service (used with `withFeePayer` transport wrapping).
 *
 * @returns An object with `account`, `feePayer`, `feePayerUrl`, and `recipient`.
 */
export declare function resolve(parameters: resolve.Parameters): {
    account: Account | undefined;
    feePayer: Account | undefined;
    feePayerUrl: string | undefined;
    recipient: Address | undefined;
};
export declare namespace resolve {
    type Parameters = {
        recipient?: Address | undefined;
        /** Account or address that performs payment operations / receives payment. */
        account?: Account | Address | undefined;
        /** When `true`, the account also sponsors fees. An `Account` object or URL string can also be provided as a dedicated fee payer. */
        feePayer?: Account | string | true | undefined;
    };
}
//# sourceMappingURL=account.d.ts.map