import type { PathSegment } from '../validation/index.ts';
import type { TextSource } from './text-parts.ts';

/** What a request is matched against: a declared method and the segments of its path. */
export type Matchable = { readonly method: string; readonly segments: readonly PathSegment[] };

/** The declared Endpoint a request matched, with where its text comes from, or none. */
export type Match<Matched extends Matchable> =
  | { readonly kind: 'none' }
  | { readonly kind: 'matched'; readonly matched: Matched; readonly source: TextSource };

/**
 * What a request's method and path match exactly, segment by segment, each percent-decoded on its
 * own; among several, the one with a literal at the first segment where they differ.
 */
export function matchOf<Matched extends Matchable>(
  declared: readonly Matched[],
  request: Request,
): Match<Matched> {
  const url = new URL(request.url);
  const texts = segmentTextsOf(url.pathname);
  if (texts.includes('')) {
    return { kind: 'none' };
  }
  let best: Matched | undefined;
  for (const candidate of declared) {
    if (candidate.method === request.method && isMatchedBy(candidate.segments, texts)) {
      best = best === undefined || beats(candidate.segments, best.segments) ? candidate : best;
    }
  }
  if (best === undefined) {
    return { kind: 'none' };
  }
  const params = paramsOf(best.segments, texts);
  const source = { params, query: url.searchParams, headers: request.headers };
  return { kind: 'matched', matched: best, source };
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

/** Whether a path has a literal at the first segment where it and another differ. */
function beats(segments: readonly PathSegment[], other: readonly PathSegment[]): boolean {
  const index = segments.findIndex((segment, at) => segment.kind !== other[at]?.kind);
  return segments[index]?.kind === 'literal';
}

/** The text of each param, by its name. */
function paramsOf(
  segments: readonly PathSegment[],
  texts: readonly string[],
): Readonly<Record<string, string>> {
  const params: (readonly [string, string])[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'param') {
      params.push([segment.name, texts[index] ?? '']);
    }
  }
  return Object.fromEntries(params);
}
