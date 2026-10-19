/** The texts URL parsing resolves away, so no path param can arrive as one of them. */
const dotSegments: ReadonlySet<string> = new Set(['.', '..']);

/**
 * Whether a text can travel as one path segment and arrive as itself: not empty, which matches
 * nothing, not a dot segment, which URL parsing removes, and well-formed, so it encodes as UTF-8.
 */
export function isSegmentText(text: string): boolean {
  return text !== '' && !dotSegments.has(text) && text.isWellFormed();
}

/** Whether a text can travel as a query value: well-formed, so no lone surrogate is replaced. */
export function isQueryText(text: string): boolean {
  return text.isWellFormed();
}

/** A text as one path segment: percent-encoded whole, a `/` included. */
export function segmentOf(text: string): string {
  return encodeURIComponent(text);
}

/** A segment percent-decoded on its own, or as sent when it is not valid percent-encoding. */
export function segmentTextOf(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
