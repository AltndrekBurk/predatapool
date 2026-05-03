import { type Plugin } from './plugin.js';
export declare function tempo(): Plugin;
interface TempoKeyEntry {
    wallet_type: string;
    wallet_address: string;
    chain_id: number;
}
export declare function readTempoKeystore(): TempoKeyEntry[];
export declare function resolveTempoAccount(accountName: string): TempoKeyEntry | undefined;
export {};
//# sourceMappingURL=tempo.d.ts.map