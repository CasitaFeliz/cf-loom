import type { PathSegment } from '../validation/index.ts';

/** What a request is matched against: a declared method and the segments of its path. */
export type Matchable = { readonly method: string; readonly segments: readonly PathSegment[] };

/** The declared Endpoint a request matched, with the texts of its params by name, or none. */
export type Match<Matched extends Matchable> =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'matched';
      readonly matched: Matched;
      readonly params: Readonly<Record<string, string>>;
    };

/**
 * What a request's method and path match exactly, segment by segment, each percent-decoded on its
 * own; among several, the one with a literal at the first segment where they differ.
 */
export function matchOf<Matched extends Matchable>(
  declared: readonly Matched[],
  method: string,
  pathname: string,
): Match<Matched> {
  const texts = segmentTextsOf(pathname);
  if (texts.includes('')) {
    return { kind: 'none' };
  }
  let best: Matched | undefined;
  for (const candidate of declared) {
    if (candidate.method === method && isMatchedBy(candidate.segments, texts)) {
      best = best === undefined || beats(candidate.segments, best.segments) ? candidate : best;
    }
  }
  if (best === undefined) {
    return { kind: 'none' };
  }
  return { kind: 'matched', matched: best, params: paramsOf(best.segments, texts) };
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
