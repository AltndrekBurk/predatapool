/**
 * Wraps a payment handler so each method returns a framework-specific
 * handler instead of the raw method response.
 *
 * @param mppx - The payment handler created by `Mppx.create`.
 * @param wrapper - A function that adapts a method function into a framework handler.
 */
export function wrap(mppx, wrapper) {
    const { compose: _, ...rest } = mppx;
    const result = { ...rest };
    for (const mi of mppx.methods) {
        const key = `${mi.name}/${mi.intent}`;
        const methodFn = mppx[key];
        const wrapWithMeta = (options) => {
            const configured = methodFn(options);
            const handler = wrapper(methodFn, options);
            if (configured._internal)
                handler._internal = configured._internal;
            return handler;
        };
        result[key] = wrapWithMeta;
        // Also set shorthand intent key if Mppx registered it (no collision)
        if (mppx[mi.intent])
            result[mi.intent] = wrapWithMeta;
        // Build nested handlers: wrapped.tempo.charge(...)
        if (!result[mi.name] || typeof result[mi.name] !== 'object')
            result[mi.name] = {};
        result[mi.name][mi.intent] = wrapWithMeta;
    }
    return result;
}
//# sourceMappingURL=mppx.js.map