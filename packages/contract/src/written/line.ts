/** The code points of every character some reader ends a line at: those of `str.splitlines`. */
const lineBreakCodes = [0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029] as const;

const escapes: ReadonlyMap<string, string> = new Map(
  lineBreakCodes.map((code) => [String.fromCharCode(code), escapeOf(code)]),
);

const lineBreak = new RegExp(`[${[...escapes.keys()].join('')}]`, 'g');

function escapeOf(code: number): string {
  if (code === 0x0a) {
    return '\\n';
  }
  if (code === 0x0d) {
    return '\\r';
  }
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

/**
 * A text as one line, as cf-loom writes every line: each line break inside it, CR, LF, VT, FF, FS,
 * GS, RS, U+0085, U+2028 and U+2029, written as the visible text of its escape, so no reader splits
 * it there.
 */
export function unbrokenLineOf(text: string): string {
  return text.replace(lineBreak, (character) => escapes.get(character) ?? character);
}

/** Lines as one message: each written by `unbrokenLineOf`, joined by LF, so each problem stays one line. */
export function linesTextOf(lines: readonly string[]): string {
  return lines.map(unbrokenLineOf).join('\n');
}
