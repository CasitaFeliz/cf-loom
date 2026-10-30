import { basePathOf } from '@cf-loom/client/internal';
import {
  allowedMethodsOf,
  matchOf,
  type TextSource,
  unbrokenLineOf,
} from '@cf-loom/contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import type { FakedProvider, ListedEndpoint, ShadowingEndpoint } from './provided.ts';

/**
 * A request that reached a listed Endpoint, with where its text comes from and the other methods
 * the listed Endpoints and the ones their cuts list as `shadowing` take on its path, which a
 * scripted `METHOD_NOT_ALLOWED` lists.
 */
export type ListedMatch = {
  readonly kind: 'listed';
  readonly listed: ListedEndpoint;
  readonly source: TextSource;
  readonly otherMethods: readonly string[];
};

/** What a request reached: a listed Endpoint, or a Retired one the Dependency does not list. */
export type Matched = ListedMatch | { readonly kind: 'retired' };

/**
 * The Endpoint a request reaches: its path, under the base URL's path, matched against the
 * Endpoints the Dependency lists, any other origin included, then its winner taken among those and
 * the ones their cuts list as `shadowing`. A path outside the base URL, one no listed Endpoint
 * matches, its method included, or one a live Endpoint the Dependency does not list wins, is the
 * test's mistake.
 */
export function matchedOf(faked: FakedProvider, request: Request): Matched {
  const url = new URL(request.url);
  const path = pathUnderOf(faked, url.pathname);
  const routedUrl = new URL(url);
  routedUrl.pathname = path;
  const routed = new Request(routedUrl, { method: request.method, headers: request.headers });
  const match = matchOf(faked.listed, routed);
  const unmatched = `no Endpoint the Dependency lists is ${request.method} ${path} under ${basePathOf(faked.base)}/`;
  switch (match.kind) {
    case 'none':
      throw mistakeOf({ provider: faked.provider, what: unmatched });
    case 'other-method': {
      const what = `${unmatched}; that path takes ${match.allowed.join(', ')}`;
      throw mistakeOf({ provider: faked.provider, what });
    }
    case 'matched':
      return winnerOf(faked, routed);
  }
}

/** What a request a listed Endpoint matches reaches: the declared Endpoint that wins it, as `serve` routes it. */
function winnerOf(faked: FakedProvider, routed: Request): Matched {
  const winner = matchOf(faked.declared, routed);
  if (winner.kind !== 'matched') {
    const reached = `${routed.method} ${new URL(routed.url).pathname}`;
    throw new Error(
      unbrokenLineOf(`${reached} matches a listed Endpoint and no declared one: a bug.`),
    );
  }
  const { matched } = winner;
  if (matched.kind === 'shadowing') {
    return shadowedMatchOf(faked, matched);
  }
  const allowed = allowedMethodsOf(faked.declared, routed);
  const otherMethods = allowed.filter((method) => method !== routed.method);
  return { kind: 'listed', listed: matched, source: winner.source, otherMethods };
}

/**
 * An Endpoint the Dependency does not list that wins a request: a Retired one answers it, any
 * other is the test's mistake.
 */
function shadowedMatchOf(faked: FakedProvider, shadowing: ShadowingEndpoint): Matched {
  if (shadowing.lifecycle === 'retired') {
    return { kind: 'retired' };
  }
  const what = `the request is won by ${shadowing.identity}, which the Dependency does not list`;
  throw mistakeOf({ provider: faked.provider, what });
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
