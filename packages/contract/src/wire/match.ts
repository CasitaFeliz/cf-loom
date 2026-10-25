import type { PathSegment } from '../written/index.ts';
import type { TextSource } from './text-parts.ts';
import { isSegmentText, segmentTextOf } from './url-text.ts';

/** What a request is matched against: a declared method and the segments of its path. */
export type Matchable = { readonly method: string; readonly segments: readonly PathSegment[] };

/**
 * The declared Endpoint a request matched, with where its text comes from; the methods its path
 * takes when declared Endpoints have the path but none the method; or none.
 */
export type Match<Matched extends Matchable> =
  | { readonly kind: 'none' }
  | { readonly kind: 'other-method'; readonly allowed: readonly string[] }
  | { readonly kind: 'matched'; readonly matched: Matched; readonly source: TextSource };

/**
 * What a request's method and path match exactly, segment by segment, each percent-decoded on its
 * own; a segment no param can travel as, an empty one, matches nothing; among several, the one
 * with a literal at the first segment where they differ.
 */
export function matchOf<Matched extends Matchable>(
  declared: readonly Matched[],
  request: Request,
): Match<Matched> {
  const url = new URL(request.url);
  const texts = segmentTextsOf(url.pathname);
  if (!texts.every(isSegmentText)) {
    return { kind: 'none' };
  }
  const best = matchedOf(declared, request.method, texts);
  if (best === undefined) {
    return unmatchedOf(declared, texts);
  }
  const params = paramsOf(best.segments, texts);
  const source = { params, query: url.searchParams, headers: request.headers };
  return { kind: 'matched', matched: best, source };
}

/**
 * The declared Endpoint a method and a path's decoded segments match exactly: among several, the
 * one with a literal at the first segment where they differ, by routing precedence.
 */
export function matchedOf<Matched extends Matchable>(
  declared: readonly Matched[],
  method: string,
  texts: readonly string[],
): Matched | undefined {
  let best: Matched | undefined;
  for (const candidate of declared) {
    if (candidate.method === method && isMatchedBy(candidate.segments, texts)) {
      best = best === undefined || beats(candidate.segments, best.segments) ? candidate : best;
    }
  }
  return best;
}

/** No Endpoint with this method: the methods of those that have the path, or none. */
function unmatchedOf<Matched extends Matchable>(
  declared: readonly Matched[],
  texts: readonly string[],
): Match<Matched> {
  const allowed = methodsOnPathOf(declared, texts);
  return allowed.length === 0 ? { kind: 'none' } : { kind: 'other-method', allowed };
}

/** The methods declared Endpoints take on a request's path, once each in code point order, as `Allow` lists them. */
export function allowedMethodsOf(
  declared: readonly Matchable[],
  request: Request,
): readonly string[] {
  const texts = segmentTextsOf(new URL(request.url).pathname);
  return texts.every(isSegmentText) ? methodsOnPathOf(declared, texts) : [];
}

function methodsOnPathOf(declared: readonly Matchable[], texts: readonly string[]): string[] {
  const onPath = declared.filter((candidate) => isMatchedBy(candidate.segments, texts));
  return [...new Set(onPath.map(({ method }) => method))].sort();
}

/** The decoded segments of a request path; the root has none. */
function segmentTextsOf(pathname: string): readonly string[] {
  if (pathname === '/') {
    return [];
  }
  return pathname.slice(1).split('/').map(segmentTextOf);
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
