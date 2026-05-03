import type * as Challenge from '../Challenge.js';
import type * as Method from '../Method.js';
import type { Config } from './config.js';
import type { Plugin } from './plugins/plugin.js';
export declare function resolvePlugin(challenge: Challenge.Challenge, config?: {
    plugins?: Plugin[] | undefined;
    methods?: any;
}): {
    plugin?: Plugin | undefined;
    method?: Method.AnyClient | undefined;
};
export declare function selectChallenge(challenges: readonly Challenge.Challenge[], config?: Config | undefined): ({
    challenge: Challenge.Challenge;
} & {
    plugin?: Plugin | undefined;
    method?: Method.AnyClient | undefined;
}) | undefined;
export declare function resolveAcceptPayment(config?: Config | undefined): string | undefined;
export declare function flattenConfigMethods(config?: Pick<Config, 'methods'> | undefined): Method.AnyClient[] | undefined;
export declare function loadConfig(configFile?: string | undefined): Promise<{
    config: Config;
    path: string;
} | undefined>;
//# sourceMappingURL=internal.d.ts.map