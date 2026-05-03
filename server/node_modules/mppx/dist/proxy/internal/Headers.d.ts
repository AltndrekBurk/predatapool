/** Strips hop-by-hop, auth, encoding, cookie, and forwarding headers from a request before proxying upstream. */
export declare function scrub(headers: Headers): Headers;
/** Strips `content-encoding` and `content-length` from an upstream response so the proxy can re-stream it. */
export declare function scrubResponse(response: Response): Response;
//# sourceMappingURL=Headers.d.ts.map