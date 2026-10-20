import { basePathOf } from '@cf-loom/client/internal';
import { matchOf, type TextSource } from '@cf-loom/contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import type { ListedEndpoint, Provided } from './provided.ts';

/** A request that reached a listed Endpoint, with where its text comes from. */
export type Matched = { readonly listed: ListedEndpoint; readonly source: TextSource };

/**
 * The listed Endpoint a request reaches: its path, under the base URL's path, matched against
 * every Endpoint the Provider exports; any other origin is the fake's too. A path outside the base
 * URL, or one no exported Endpoint matches, or one an unlisted Endpoint takes, is the test's mistake.
 */
export function matchedOf(provided: Provided, request: Request): Matched {
  const url = new URL(request.url);
  const path = pathUnderOf(provided, url.pathname);
  const routedUrl = new URL(url);
  routedUrl.pathname = path;
  const routed = new Request(routedUrl, { method: request.method, headers: request.headers });
  const match = matchOf(provided.exported, routed);
  if (match.kind === 'none') {
    const what = `no Endpoint it exports is ${request.method} ${path} under ${basePathOf(provided.base)}/`;
    throw mistakeOf({ provider: provided.provider, what });
  }
  const { listed, identity } = match.matched;
  if (listed === undefined) {
    const what = `the Dependency does not list ${identity}, which ${request.method} ${path} reaches`;
    throw mistakeOf({ provider: provided.provider, what });
  }
  return { listed, source: match.source };
}

/** A request's path with the base URL's path taken off, or the test's mistake when it lies outside. */
function pathUnderOf(provided: Provided, pathname: string): string {
  const prefix = basePathOf(provided.base);
  if (prefix === '') {
    return pathname;
  }
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    const what = `the path ${pathname} is outside the base URL's path ${prefix}/`;
    throw mistakeOf({ provider: provided.provider, what });
  }
  return pathname.slice(prefix.length) || '/';
}
