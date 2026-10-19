import type { PathSegment } from '@casitafeliz/loom-contract/internal';

/** What a request is matched against: a declared method and the segments of its path. */
export type Route = { readonly method: string; readonly segments: readonly PathSegment[] };

/** The route a request matched, with the texts of its params in path order, or none. */
export type Match<Matched extends Route> =
  | { readonly kind: 'none' }
  | { readonly kind: 'matched'; readonly route: Matched; readonly params: readonly string[] };

/**
 * The route a request's method and path match exactly, segment by segment, each percent-decoded on
 * its own; among several, the one with a literal at the first segment where they differ.
 */
export function matchOf<Matched extends Route>(
  routes: readonly Matched[],
  method: string,
  pathname: string,
): Match<Matched> {
  const texts = segmentTextsOf(pathname);
  if (texts.includes('')) {
    return { kind: 'none' };
  }
  let best: Matched | undefined;
  for (const route of routes) {
    if (route.method === method && isMatchedBy(route.segments, texts)) {
      best = best === undefined || beats(route.segments, best.segments) ? route : best;
    }
  }
  if (best === undefined) {
    return { kind: 'none' };
  }
  return { kind: 'matched', route: best, params: paramTextsOf(best.segments, texts) };
}

/** The decoded segments of a request path; the root has none, and an empty one matches nothing. */
function segmentTextsOf(pathname: string): readonly string[] {
  if (pathname === '/') {
    return [];
  }
  return pathname.slice(1).split('/').map(decodedOf);
}

/** A segment percent-decoded, or as sent when it is not valid percent-encoding. */
function decodedOf(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isMatchedBy(segments: readonly PathSegment[], texts: readonly string[]): boolean {
  if (segments.length !== texts.length) {
    return false;
  }
  return segments.every((segment, index) => {
    return segment.kind === 'param' || segment.text === texts[index];
  });
}

/** Whether a route has a literal at the first segment where it and another differ. */
function beats(segments: readonly PathSegment[], other: readonly PathSegment[]): boolean {
  const index = segments.findIndex((segment, at) => segment.kind !== other[at]?.kind);
  return segments[index]?.kind === 'literal';
}

function paramTextsOf(
  segments: readonly PathSegment[],
  texts: readonly string[],
): readonly string[] {
  const params: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'param') {
      params.push(texts[index] ?? '');
    }
  }
  return params;
}
