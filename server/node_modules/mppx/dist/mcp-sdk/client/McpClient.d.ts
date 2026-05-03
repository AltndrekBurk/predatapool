import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpError } from '@modelcontextprotocol/sdk/types.js';
import type * as Challenge from '../../Challenge.js';
import * as core_Mcp from '../../Mcp.js';
import type * as Method from '../../Method.js';
import type * as z from '../../zod.js';
type AnyClient = Method.Client<any, any>;
/**
 * Result of a tool call with payment handling.
 * Extends the SDK's callTool return type with an optional payment receipt.
 */
export type CallToolResult = Awaited<ReturnType<Client['callTool']>> & {
    /** Payment receipt if payment was made. */
    receipt: core_Mcp.Receipt | undefined;
};
/**
 * Creates a payment-aware wrapper around an MCP SDK client.
 *
 * Similar to `Fetch.from()` for HTTP, this wraps an MCP client's `callTool`
 * method to automatically handle payment challenges.
 *
 * @example
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client'
 * import { McpClient, tempo } from 'mppx/mcp-sdk/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const client = new Client({ name: 'my-client', version: '1.0.0' })
 * await client.connect(transport)
 *
 * const mcp = McpClient.wrap(client, {
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Automatically handles payment challenges
 * const result = await mcp.callTool({ name: 'premium_tool', arguments: {} })
 * console.log(result.content, result.receipt)
 * ```
 */
export declare function wrap<const client extends Pick<Client, 'callTool'>, const methods extends readonly Method.AnyClient[]>(client: client, config: wrap.Config<methods>): wrap.McpClient<client, methods>;
/** Union of all context types from all methods that have context schemas. */
type AnyContextFor<methods extends readonly AnyClient[]> = {
    [key in keyof methods]: methods[key] extends Method.Client<any, infer context> ? context extends z.ZodMiniType ? z.input<context> : undefined : undefined;
}[number];
export declare namespace wrap {
    type Config<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = {
        /** Array of methods to use. */
        methods: methods;
    };
    type McpClient<client extends Pick<Client, 'callTool'> = Pick<Client, 'callTool'>, methods extends readonly AnyClient[] = readonly AnyClient[]> = Omit<client, 'callTool'> & {
        /** Call a tool with automatic payment handling. */
        callTool: (params: {
            name: string;
            arguments?: Record<string, unknown>;
            _meta?: Record<string, unknown>;
        }, options?: CallToolOptions<methods>) => Promise<CallToolResult>;
    };
    type CallToolOptions<methods extends readonly AnyClient[] = readonly AnyClient[]> = {
        /** Context to pass to the method intent's createCredential. */
        context?: AnyContextFor<methods>;
        /** Request timeout in milliseconds. */
        timeout?: number;
    };
}
/**
 * Checks if an error is a payment required error.
 */
export declare function isPaymentRequiredError(error: unknown): error is McpError & {
    data: {
        challenges: Challenge.Challenge[];
    };
};
export {};
//# sourceMappingURL=McpClient.d.ts.map