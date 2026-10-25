/**
 * An HTTP exchange as the web platform's `fetch` makes it: a Request answered with a Response.
 * `serve` returns one, and a client's `fetch` is one, `globalThis.fetch` included.
 */
export type Http = (request: Request) => Promise<Response>;
