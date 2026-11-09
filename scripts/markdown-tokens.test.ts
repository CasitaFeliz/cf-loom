import type { MarkedToken } from 'marked';
import { describe, expect, it } from 'vitest';
import {
  type Container,
  containers,
  type MarkdownBlock,
  placed,
  tokenTypes,
} from './markdown-containers.ts';
import { type LocatedToken, locatedTokens } from './markdown-tokens.ts';
import { aSeededDraw, type Draw, pickFrom } from './seeded-draw.ts';

function linesOf(markdown: string, type: MarkedToken['type']): number[] {
  const found = locatedTokens(markdown).filter(({ token }) => token.type === type);
  return found.map(({ line }) => line);
}

describe('locatedTokens', () => {
  it('names a fenced block in a blockquote after a paragraph at its own line', () => {
    const markdown = ['> one', '> two', '>', '> ```ts', '> const a = 1;', '> ```'].join('\n');

    const lines = linesOf(markdown, 'code');

    expect(lines).toEqual([4]);
  });

  it('names the second paragraph of a blockquote at its own line', () => {
    const markdown = ['> one', '>', '> two', '> three'].join('\n');

    const lines = linesOf(markdown, 'paragraph');

    expect(lines).toEqual([1, 3]);
  });

  it('names a nested list item at its own line, whatever its parent wraps over', () => {
    const markdown = [
      '- the problem first, and the existing concept that',
      '  already covers it;',
      '- its inputs, each part where it applies:',
      '  - each value the change reads that it did not',
      '    build, with the cases its tests cover;',
      '  - for code that reads a structure:',
      '    its bound in time;',
      '- the test list',
    ].join('\n');

    const lines = linesOf(markdown, 'list_item');

    expect(lines).toEqual([1, 3, 4, 6, 8]);
  });

  it('names a code span in a table cell holding a pipe at its row, and the header on the table', () => {
    const markdown = [
      'Text.',
      '',
      '| Command | Does |',
      '| --- | --- |',
      '| `init [a \\| b]` | first |',
      '| second | `x \\| y` |',
    ].join('\n');

    const lines = locatedTokens(markdown)
      .filter(({ token }) => token.type === 'codespan' || token.type === 'table')
      .map(({ token, line }) => `${token.type}@${line}`);

    expect(lines).toEqual(['table@3', 'codespan@5', 'codespan@6']);
  });

  it('names a header cell on the line of its table, and each row a line after the one before', () => {
    const markdown = ['| head one | head two |', '| --- | --- |', '| a | b |', '| c | d |'].join(
      '\n',
    );

    const lines = locatedTokens(markdown)
      .filter(({ token }) => token.type === 'text')
      .map(({ token, line }) => `${(token as { text: string }).text}@${line}`);

    expect(lines).toEqual(['head one@1', 'head two@1', 'a@3', 'b@3', 'c@4', 'd@4']);
  });

  it('names a token in a quote whose prefix holds a tab at its own line', () => {
    const markdown = ['>\tone', '>', '>\ttwo *three*', '>\tfour'].join('\n');

    const lines = locatedTokens(markdown)
      .filter(({ token }) => token.type === 'paragraph' || token.type === 'em')
      .map(({ token, line }) => `${token.type}@${line}`);

    expect(lines).toEqual(['paragraph@1', 'paragraph@3', 'em@3']);
  });

  it('numbers the lines of a text with CRLF line ends as it does one with LF', () => {
    const lines = ['- a', '  - b', '', '> c', '>', '> d'];

    const withCrlf = locatedTokens(lines.join('\r\n'));
    const withLf = locatedTokens(lines.join('\n'));

    expect(withCrlf.map(({ line }) => line)).toEqual(withLf.map(({ line }) => line));
  });

  it('gives each token the token that holds it, and a table cell the table', () => {
    const markdown = ['> a *b*', '', '| h |', '| - |', '| c |'].join('\n');

    const parents = locatedTokens(markdown).map(
      ({ token, parent }) => `${token.type} in ${parent?.type ?? 'nothing'}`,
    );

    expect(parents).toEqual([
      'blockquote in nothing',
      'paragraph in blockquote',
      'text in paragraph',
      'em in paragraph',
      'text in em',
      'space in nothing',
      'table in nothing',
      'text in table',
      'text in table',
    ]);
  });
});

/** A marker word, which a line of the drawn Markdown carries so that every token can be checked against its line. */
const markerWord = /m(\d+)x/;

const inlineForms: readonly ((word: string) => string)[] = [
  (word) => word,
  (word) => `*${word}*`,
  (word) => `**${word}**`,
  (word) => `~~${word}~~`,
  (word) => `\`${word}\``,
  (word) => `${word}\\*`,
  (word) => `![${word}](./image.png)`,
  (word) => `[${word}](./page.md)`,
  (word) => `<b data-word="${word}">${word}</b>`,
  (word) => `<https://${word}.example>`,
  (word) => `https://${word}.example`,
];

function paragraphOf(draw: Draw): MarkdownBlock {
  const lines = Array.from({ length: 1 + Math.floor(draw() * 3) }, () => {
    const forms = Array.from({ length: 1 + Math.floor(draw() * 2) }, () =>
      pickFrom(draw, inlineForms),
    );
    return forms.map((form) => form('@')).join(' ');
  });
  const ends = lines.map((line, row) => {
    const isBreak = row < lines.length - 1 && draw() < 0.3;
    return isBreak ? `${line}${pickFrom(draw, ['  ', '\\'])}` : line;
  });
  return { lines: ends, isParagraph: true };
}

const blockForms: Record<string, (draw: Draw) => readonly string[]> = {
  'an ATX heading': () => ['## *@*'],
  'a setext heading': (draw) => ['@', pickFrom(draw, ['===', '---'])],
  'a backtick fence': () => ['```ts', '@', '@', '```'],
  'a four-backtick fence holding three': () => ['````', '@', '```', '@', '````'],
  'a tilde fence': () => ['~~~', '@', '~~~'],
  'indented code': () => ['    @', '    @'],
  'a table with an escaped pipe': () => ['| @ | @ |', '|---|---|', '| `@\\|@` | @ |', '| @ | @ |'],
  'an HTML comment': () => ['<!-- @ -->'],
  'an HTML comment over lines': () => ['<!--', '@', '-->'],
  'a definition': () => ['[@]: ./@.md'],
  'a thematic break': () => ['***'],
  'a link split over two lines': () => ['[@](', './@.md)'],
  'a nested list': () => ['- @', '  @', '  - @', '    @', '- @'],
  'a task list': () => ['- [ ] @', '- [x] @'],
  'a quote': () => ['> @', '>', '> @'],
};

function aBlock(draw: Draw): MarkdownBlock {
  const names = ['a paragraph', ...Object.keys(blockForms)];
  const name = pickFrom(draw, names);
  const form = blockForms[name];
  return form === undefined ? paragraphOf(draw) : { lines: form(draw), isParagraph: false };
}

/** Two to four copies, each the first block with a chance of 0.7 and a new one otherwise. */
function repeatedBlocks(draw: Draw, container: Container): MarkdownBlock[] {
  const first = aBlock(draw);
  const length = 2 + Math.floor(draw() * 3);
  const blocks = Array.from({ length }, () => (draw() < 0.7 ? first : aBlock(draw)));
  return container.needsText ? [paragraphOf(draw), ...blocks] : blocks;
}

/** The lines of a document, each marker `@` replaced by the word of the line it is on. */
function markedUp(lines: readonly string[]): string {
  return `${lines.map((line, row) => line.replaceAll('@', `m${row + 1}x`)).join('\n')}\n`;
}

function documentIn(container: Container, draw: Draw): string {
  const top = containers['the top level'] as Container;
  const before = Array.from({ length: Math.floor(draw() * 3) }, () => paragraphOf(draw));
  const lines = [...placed(before, top, draw).lines];
  const inside = placed(repeatedBlocks(draw, container), container, draw).lines;
  return markedUp(lines.length === 0 ? inside : [...lines, '', ...inside]);
}

function breaksIn(text: string): number {
  return text.split('\n').length - 1;
}

/** The line a token starts on, from the marker its source holds, or `undefined` for one that holds none. */
function lineOfMarker(token: MarkedToken): number | undefined {
  const marker = markerWord.exec(token.raw);
  return marker === null
    ? undefined
    : Number(marker[1]) - breaksIn(token.raw.slice(0, marker.index));
}

/**
 * The line each token must be on. A token that holds a marker is on its marker's line, less the line breaks before it.
 * One that holds none (a break, an escape, a closing tag, a rule, a checkbox) is where the token before it ends, or
 * where its parent starts when it is the first, both taken from their own markers. A table's cells are no sequence, so
 * a cell's token with no marker has no expected line.
 */
function expectedLinesOf(located: readonly LocatedToken[]): Map<MarkedToken, number | undefined> {
  const expected = new Map<MarkedToken, number | undefined>();
  const last = new Map<MarkedToken | undefined, MarkedToken>();
  for (const { token, parent } of located) {
    const before = last.get(parent);
    const inSequence = parent?.type !== 'table';
    expected.set(
      token,
      lineOfMarker(token) ?? (inSequence ? afterOrIn(before, parent, expected) : undefined),
    );
    last.set(parent, token);
  }
  return expected;
}

/** The line where `before` ends, or where `parent` starts when `before` is the first of its parent's tokens. */
function afterOrIn(
  before: MarkedToken | undefined,
  parent: MarkedToken | undefined,
  expected: Map<MarkedToken, number | undefined>,
): number | undefined {
  if (before !== undefined) {
    const start = expected.get(before);
    return start === undefined ? undefined : start + breaksIn(before.raw);
  }
  return parent === undefined ? 1 : expected.get(parent);
}

/** Each token not on the line its markers give, a `space` left out since its line is the one before its gap. */
function wrongLinesOf(markdown: string): string[] {
  const located = locatedTokens(markdown);
  const expected = expectedLinesOf(located);
  const wrong: string[] = [];
  for (const { token, line } of located) {
    const want = expected.get(token);
    if (token.type !== 'space' && want !== undefined && want !== line) {
      wrong.push(`${token.type} ${JSON.stringify(token.raw)} is on line ${line}, not ${want}`);
    }
  }
  return wrong;
}

describe('locatedTokens over every block in every container', () => {
  const draw = aSeededDraw(551);
  const reached = new Set<string>();
  const wrong: string[] = [];
  for (const [name, container] of Object.entries(containers)) {
    for (let sample = 0; sample < 400; sample++) {
      const markdown = documentIn(container, draw);
      for (const { token } of locatedTokens(markdown)) {
        reached.add(token.type);
      }
      for (const problem of wrongLinesOf(markdown)) {
        wrong.push(`${name}: ${problem} in ${JSON.stringify(markdown)}`);
      }
    }
  }

  it('locates every token kind at the line its source starts, in every container, repeated or not', () => {
    expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
  });

  it('draws every type of token marked produces', () => {
    const missing = Object.keys(tokenTypes).filter((type) => !reached.has(type));

    expect(missing).toEqual([]);
  });
});
