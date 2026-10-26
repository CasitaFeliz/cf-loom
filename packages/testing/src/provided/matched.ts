import { basePathOf } from '@cf-loom/client/internal';
import { allowedMethodsOf, type Match, matchOf, type TextSource } from '@cf-loom/contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import type { FakedProvider, ListedEndpoint } from './provided.ts';

/**
 * A request that reached a listed Endpoint, with where its text comes from and the other methods
 * the Provider's exported Endpoints take on its path, which a scripted `METHOD_NOT_ALLOWED` lists.
 */
export type Matched = {
  readonly listed: ListedEndpoint;
  readonly source: TextSource;
  readonly otherMethods: readonly string[];
};

/**
 * The listed Endpoint a request reaches: its path, under the base URL's path, matched against
 * every Endpoint the Provider exports; any other origin is the fake's too. A path outside the base
 * URL, one no exported Endpoint matches, its method included, or one an unlisted Endpoint takes, is
 * the test's mistake.
 */
export function matchedOf(faked: FakedProvider, request: Request): Matched {
  const url = new URL(request.url);
  const path = pathUnderOf(faked, url.pathname);
  const routedUrl = new URL(url);
  routedUrl.pathname = path;
  const routed = new Request(routedUrl, { method: request.method, headers: request.headers });
  const match = matchOf(faked.exported, routed);
  const unmatched = `no Endpoint it exports is ${request.method} ${path} under ${basePathOf(faked.base)}/`;
  switch (match.kind) {
    case 'none':
      throw mistakeOf({ provider: faked.provider, what: unmatched });
    case 'other-method': {
      const what = `${unmatched}; that path takes ${match.allowed.join(', ')}`;
      throw mistakeOf({ provider: faked.provider, what });
    }
    case 'matched': {
      const listed = listedMatchOf(faked, match, `${request.method} ${path}`);
      const allowed = allowedMethodsOf(faked.exported, routed);
      const otherMethods = allowed.filter((method) => method !== request.method);
      return { ...listed, otherMethods };
    }
  }
}

/** A matched exported Endpoint, or the test's mistake when the Dependency does not list it. */
function listedMatchOf(
  faked: FakedProvider,
  match: Extract<Match<FakedProvider['exported'][number]>, { readonly kind: 'matched' }>,
  reached: string,
): Omit<Matched, 'otherMethods'> {
  const { listed, identity } = match.matched;
  if (listed === undefined) {
    const what = `the Dependency does not list ${identity}, which ${reached} reaches`;
    throw mistakeOf({ provider: faked.provider, what });
  }
  return { listed, source: match.source };
}

/** A request's path with the base URL's path taken off, or the test's mistake when it lies outside. */
function pathUnderOf(faked: FakedProvider, pathname: string): string {
  const prefix = basePathOf(faked.base);
  if (prefix === '') {
    return pathname;
  }
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    const what = `the path ${pathname} is outside the base URL's path ${prefix}/`;
    throw mistakeOf({ provider: faked.provider, what });
  }
  return pathname.slice(prefix.length) || '/';
}
