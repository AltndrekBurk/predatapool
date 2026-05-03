import * as fs from 'node:fs';
import * as path from 'node:path';
import * as AcceptPayment from '../internal/AcceptPayment.js';
import { stripe as stripePlugin, tempo as tempoPlugin } from './plugins/index.js';
const builtinPlugins = [tempoPlugin(), stripePlugin()];
export function resolvePlugin(challenge, config) {
    const configPlugin = config?.plugins?.find((p) => supportsPlugin(p, challenge));
    if (configPlugin)
        return { plugin: configPlugin };
    const builtin = builtinPlugins.find((p) => supportsPlugin(p, challenge));
    if (builtin)
        return { plugin: builtin };
    const configMethods = flattenConfigMethods(config);
    const matched = configMethods?.find((m) => m.name === challenge.method && m.intent === challenge.intent);
    if (matched)
        return { method: matched };
    return {};
}
export function selectChallenge(challenges, config) {
    const configMethods = flattenConfigMethods(config);
    if (configMethods?.length) {
        const resolvedPreferences = AcceptPayment.resolve(configMethods, config?.paymentPreferences);
        const selected = AcceptPayment.selectChallenge(challenges, configMethods, resolvedPreferences.entries);
        if (selected) {
            return { challenge: selected.challenge, ...resolvePlugin(selected.challenge, config) };
        }
        return undefined;
    }
    for (const challenge of challenges) {
        const resolved = resolvePlugin(challenge, config);
        if (resolved.plugin || resolved.method)
            return { challenge, ...resolved };
    }
    return undefined;
}
export function resolveAcceptPayment(config) {
    const methods = flattenConfigMethods(config);
    if (!methods?.length)
        return undefined;
    return AcceptPayment.resolve(methods, config?.paymentPreferences).header;
}
export function flattenConfigMethods(config) {
    return Array.isArray(config?.methods) ? config.methods.flat() : undefined;
}
function supportsPlugin(plugin, challenge) {
    return plugin.supports ? plugin.supports(challenge) : plugin.method === challenge.method;
}
const CONFIG_NAMES = ['mppx.config.ts', 'mppx.config.js', 'mppx.config.mjs'];
export async function loadConfig(configFile) {
    const configPath = resolveConfigPath(configFile);
    if (!configPath)
        return undefined;
    const mod = await import(configPath);
    return { config: (mod.default ?? mod), path: configPath };
}
function resolveConfigPath(configFile) {
    // 0. Explicit --config flag
    if (configFile) {
        const resolved = path.resolve(configFile);
        if (fs.existsSync(resolved))
            return resolved;
        return undefined;
    }
    // 1. Explicit env var
    const envPath = process.env.MPPX_CONFIG?.trim();
    if (envPath) {
        const resolved = path.resolve(envPath);
        if (fs.existsSync(resolved))
            return resolved;
        return undefined;
    }
    // 2. Walk up from cwd, stopping at project root
    let dir = process.cwd();
    while (true) {
        for (const name of CONFIG_NAMES) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate))
                return candidate;
        }
        const isProjectRoot = fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git'));
        const parent = path.dirname(dir);
        if (isProjectRoot || parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
//# sourceMappingURL=internal.js.map