/** The characters some reader ends a line at, with the text that shows each one. */
const lineBreaks: Readonly<Record<string, string>> = {
  '\r': '\\r',
  '\n': '\\n',
  '\u0085': '\\u0085',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * A line as the CLI writes it to stdout or stderr: every line break inside it, `\r`, `\n`, U+0085,
 * U+2028 and U+2029, written as the visible text of its escape, so no reader splits it.
 */
export function printedLineOf(line: string): string {
  return line.replace(
    /[\r\n\u0085\u2028\u2029]/g,
    (character) => lineBreaks[character] ?? character,
  );
}
