/**
 * The ten characters a reader may end a line at, each with its name and the visible text of its
 * escape, spelled here on purpose, apart from the code under test: the oracle every package's tests
 * share.
 */
export const lineBreaks = [
  ['LF', 0x0a, '\\n'],
  ['CR', 0x0d, '\\r'],
  ['U+0085', 0x85, '\\u0085'],
  ['U+2028', 0x2028, '\\u2028'],
  ['U+2029', 0x2029, '\\u2029'],
  ['U+000B', 0x0b, '\\u000b'],
  ['U+000C', 0x0c, '\\u000c'],
  ['U+001C', 0x1c, '\\u001c'],
  ['U+001D', 0x1d, '\\u001d'],
  ['U+001E', 0x1e, '\\u001e'],
] as const;

/** Splits a text where any reader would end a line. */
export const lineBreakPattern = new RegExp(
  `[${lineBreaks.map(([, code]) => String.fromCharCode(code)).join('')}]`,
);

/** How many characters of `text` are one of the ten line breaks. */
export function lineBreaksIn(text: string): number {
  return text.split(lineBreakPattern).length - 1;
}
