import { basePathOf } from '@cf-loom/client/internal';
import { allowedMethodsOf, matchOf, type TextSource } from '@cf-loom/contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import type {
  ExportedEndpoint,
  FakedProvider,
  ListedEndpoint,
  ShadowingEndpoint,
} from './provided.ts';

/**
 * A request that reached a listed Endpoint, with where its text comes from and the other methods
 * the Provider's Endpoints take on its path, which a scripted `METHOD_NOT_ALLOWED` lists.
 */
export type ListedMatch = {
  readonly kind: 'listed';
  readonly listed: ListedEndpoint;
  readonly source: TextSource;
  readonly otherMethods: readonly string[];
};

/** What a request reached: a listed Endpoint, or a Retired one its Provider does not export. */
export type Matched = ListedMatch | { readonly kind: 'retired' };

/**
 * The Endpoint a request reaches: its path, under the base URL's path, matched against the
 * Endpoints the Provider exports, any other origin included, then its winner taken among every
 * declared one. A path outside the base URL, one no exported Endpoint matches, its method
 * included, one an unlisted Endpoint wins, or one a live Endpoint the Provider does not export
 * wins, is the test's mistake.
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
    case 'matched':
      return winnerOf(faked, routed);
  }
}

/** What a request an exported Endpoint matches reaches: the declared Endpoint that wins it, as `serve` routes it. */
function winnerOf(faked: FakedProvider, routed: Request): Matched {
  const reached = `${routed.method} ${new URL(routed.url).pathname}`;
  const winner = matchOf(faked.declared, routed);
  if (winner.kind !== 'matched') {
    throw new Error(`${reached} matches an exported Endpoint and no declared one: a bug.`);
  }
  const { matched } = winner;
  if (matched.kind === 'shadowing') {
    return shadowedMatchOf(faked, matched, reached);
  }
  const listed = listedOf(faked, matched, reached);
  const allowed = allowedMethodsOf(faked.declared, routed);
  const otherMethods = allowed.filter((method) => method !== routed.method);
  return { kind: 'listed', listed, source: winner.source, otherMethods };
}

/**
 * An Endpoint the Provider does not export that wins a request: a Retired one answers it, a live
 * one is the test's mistake.
 */
function shadowedMatchOf(
  faked: FakedProvider,
  shadowing: ShadowingEndpoint,
  reached: string,
): Matched {
  if (shadowing.lifecycle === 'retired') {
    return { kind: 'retired' };
  }
  const what = `the Provider does not export ${shadowing.identity}, which ${reached} reaches`;
  throw mistakeOf({ provider: faked.provider, what });
}

/** The listed Endpoint an exported winner is, or the test's mistake when the Dependency lists none. */
function listedOf(
  faked: FakedProvider,
  exported: ExportedEndpoint,
  reached: string,
): ListedEndpoint {
  if (exported.listed === undefined) {
    const what = `the Dependency does not list ${exported.identity}, which ${reached} reaches`;
    throw mistakeOf({ provider: faked.provider, what });
  }
  return exported.listed;
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
