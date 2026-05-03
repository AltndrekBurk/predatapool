import { createClient, http } from 'viem';
import { withFeePayer } from 'viem/tempo';
export function getResolver(parameters) {
    const { chain, feePayerUrl, getClient, rpcUrl } = parameters;
    if (getClient) {
        // When a default chain with serializers is provided (e.g. Tempo chain config),
        // ensure user-provided clients inherit those serializers. Without this, clients
        // created without the Tempo chain config will use the default viem serializer,
        // causing errors like "maxFeePerGas is not a valid Legacy Transaction attribute".
        if (!chain?.serializers && !feePayerUrl)
            return getClient;
        return async (params) => {
            const client = await getClient(params);
            // Wrap the client's transport with `withFeePayer` when a fee payer URL is provided.
            if (feePayerUrl && client.transport.key !== 'feePayer') {
                const url = client.transport.url;
                if (url) {
                    const wrapped = createClient({
                        chain: client.chain,
                        transport: withFeePayer(http(url), http(feePayerUrl)),
                    });
                    Object.assign(client, { transport: wrapped.transport, request: wrapped.request });
                }
            }
            if (!chain?.serializers || client.chain?.serializers?.transaction)
                return client;
            return Object.assign({}, client, {
                chain: {
                    ...chain,
                    ...client.chain,
                    formatters: client.chain?.formatters ?? chain.formatters,
                    prepareTransactionRequest: client.chain?.prepareTransactionRequest ?? chain.prepareTransactionRequest,
                    serializers: client.chain?.serializers?.transaction
                        ? client.chain.serializers
                        : chain.serializers,
                },
            });
        };
    }
    return ({ chainId }) => {
        if (!rpcUrl)
            throw new Error('No `rpcUrl` provided.');
        const resolvedChainId = chainId || Number(Object.keys(rpcUrl)[0]);
        const url = rpcUrl[resolvedChainId];
        if (!url)
            throw new Error(`No \`rpcUrl\` configured for \`chainId\` (${resolvedChainId}).`);
        const transport = feePayerUrl ? withFeePayer(http(url), http(feePayerUrl)) : http(url);
        return createClient({
            chain: { ...chain, id: resolvedChainId },
            transport,
        });
    };
}
//# sourceMappingURL=Client.js.map