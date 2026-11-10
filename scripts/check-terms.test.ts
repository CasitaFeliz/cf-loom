import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../packages/messaging/test/test-process.ts';
import { misspelledTerms, multiWordTerms, type TermMisspelling } from './check-terms.ts';
import { type Container, containers, type MarkdownBlock, placed } from './markdown-containers.ts';
import { aSeededDraw, type Draw, pickFrom } from './seeded-draw.ts';

const repositoryDirs: string[] = [];

const root = join(import.meta.dirname, '..');
const glossaryPath = join(root, 'CONTEXT.md');

function aRepositoryWith(files: Record<string, string>): string {
  const repositoryDir = mkdtempSync(join(tmpdir(), 'check-terms-'));
  repositoryDirs.push(repositoryDir);
  writeFileSync(join(repositoryDir, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(import.meta.dirname, join(repositoryDir, 'scripts'), {
    recursive: true,
    filter: (path) => !path.endsWith('.test.ts'),
  });
  symlinkSync(join(root, 'node_modules'), join(repositoryDir, 'node_modules'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repositoryDir, path)), { recursive: true });
    writeFileSync(join(repositoryDir, path), content);
  }
  return repositoryDir;
}

async function runCheckTerms(repositoryDir: string): Promise<{ status: number; stderr: string }> {
  const run = await runProcess('node', ['scripts/check-terms.ts'], { cwd: repositoryDir });
  return { status: run.status, stderr: run.stderr };
}

/** The multi-word terms of the glossary, found by splitting each line at its `**` instead of matching them. */
function termsOf(glossary: string): string[] {
  const phrases = glossary
    .split('\n')
    .flatMap((line) => line.split('**').filter((_, index) => index % 2 === 1));
  return [...new Set(phrases.filter((phrase) => /^[A-Z]\S* \S/.test(phrase)))];
}

function titleCaseOf(words: string): string {
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function pluralOf(words: string): string {
  return /(?:x|s|ch|sh)$/.test(words) ? `${words}es` : `${words}s`;
}

afterEach(() => {
  for (const repositoryDir of repositoryDirs.splice(0)) {
    rmSync(repositoryDir, { recursive: true, force: true });
  }
});

describe('multiWordTerms', () => {
  it('takes each bold phrase of two words or more that starts with a capital', () => {
    const glossary = [
      '**Direct call**:',
      'Calling a Handler.',
      '',
      '**Former Input**:',
      'A query as published.',
    ].join('\n');

    expect(multiWordTerms(glossary)).toEqual(['Direct call', 'Former Input']);
  });

  it('takes the terms of a Handler line and a term bold inside another entry', () => {
    const glossary = [
      '**Handler**: **EndpointHandler**, **GuardHandler**, **Message Handler**:',
      'The code the runtime invokes.',
      '',
      '**Rejection**:',
      'A declared decision; a Rejection with an unknown code is an **Unknown Rejection**, which carries it.',
    ].join('\n');

    expect(multiWordTerms(glossary)).toEqual(['Message Handler', 'Unknown Rejection']);
  });

  it('leaves out single words, lower-case phrases such as declared Snapshot, and short forms in parentheses', () => {
    const glossary = [
      '**Snapshot**:',
      'The **declared Snapshot** is what `generate` writes; the **exported Snapshot cut** is a part.',
      '',
      '**Reader schema** (a Reader, for short):',
      'A schema.',
    ].join('\n');

    expect(multiWordTerms(glossary)).toEqual(['Reader schema']);
  });

  it('does not read a bold phrase in a code span as a term, and reads one in underscores', () => {
    const glossary = [
      '**Direct call**:',
      'Written as `**Fake Provider**` in code, and as __Message Handler__ in the glossary.',
    ].join('\n');

    expect(multiWordTerms(glossary)).toEqual(['Direct call', 'Message Handler']);
  });

  it('does not read an emphasized phrase as a term', () => {
    const glossary = [
      '**Direct call**:',
      'A *Fake Provider* and an _Event Handler_ are only emphasized.',
    ].join('\n');

    expect(multiWordTerms(glossary)).toEqual(['Direct call']);
  });

  it('lists a term once however many times the glossary makes it bold', () => {
    const glossary = '**Direct call**:\nCalling.\n\nElsewhere a **Direct call** is bold again.';

    expect(multiWordTerms(glossary)).toEqual(['Direct call']);
  });

  it("finds every multi-word term of this repository's CONTEXT.md", () => {
    const glossary = readFileSync(glossaryPath, 'utf8');
    const expected = termsOf(glossary);

    const terms = multiWordTerms(glossary);

    expect(expected.length).toBeGreaterThan(20);
    expect([...terms].sort()).toEqual([...expected].sort());
  });
});

describe('misspelledTerms', () => {
  it('accepts the exact spelling, its plural and its possessive', () => {
    const markdown =
      "A Direct call, two Direct calls, the Direct call's checks.\nBroker prefixes.\n";

    const misspellings = misspelledTerms(markdown, ['Direct call', 'Broker prefix']);

    expect(misspellings).toEqual([]);
  });

  it('reports a lower-case use with its line, what is written and the glossary spelling', () => {
    const markdown = 'First line.\nCalled as a direct call here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 2, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('reports a plural written in lower case and a half-capitalized term', () => {
    const markdown = 'Two direct calls.\nA Breaking change.\nSeveral broker prefixes.\n';

    const misspellings = misspelledTerms(markdown, [
      'Direct call',
      'Breaking Change',
      'Broker prefix',
    ]);

    expect(misspellings).toEqual([
      { line: 1, written: 'direct calls', spelled: 'Direct calls' },
      { line: 2, written: 'Breaking change', spelled: 'Breaking Change' },
      { line: 3, written: 'broker prefixes', spelled: 'Broker prefixes' },
    ]);
  });

  it('reports a term whose words a line break separates, at the line it starts on', () => {
    const markdown =
      'A long sentence about a direct\ncall that wraps, and a Direct\ncall that is right.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not join the words of a term across a blank line', () => {
    const markdown = 'The fake\n\nProvider answers.\n';

    const misspellings = misspelledTerms(markdown, ['Fake Provider']);

    expect(misspellings).toEqual([]);
  });

  it('reports a term in an emphasis, whose underscores are no part of a word', () => {
    const markdown = 'An _direct call_ here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not report a term inside a code span', () => {
    const markdown = 'A `direct call` in a span.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not report a term inside a code span that wraps over a line break', () => {
    const markdown = 'A `a direct\ncall` here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('reports a term after a code span that wraps over a line break', () => {
    const markdown = 'A `wrapped\nspan` and a direct call and `x`.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 2, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not report a term inside a double-backtick span that holds a backtick', () => {
    const markdown = 'A `` a direct call ` b `` here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not open a code span in the middle of a run of backticks', () => {
    const markdown = 'A ``x` direct call `y` z.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('opens a code span at a whole run of backticks, never at a part of it', () => {
    const markdown = 'A `` direct call `.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not close a code span in the middle of a run of backticks', () => {
    const markdown = 'A `x``direct call`` z.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('closes a code span only at a whole run of backticks', () => {
    const markdown = 'A ` direct call ``.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not pair a backtick with one in another paragraph', () => {
    const markdown = 'A stray ` and a direct call.\n\nAnother stray ` here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not report a term inside a fenced block', () => {
    const markdown = ['```ts', '// a direct call', '```'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not report a term inside a tilde fence', () => {
    const markdown = ['~~~', 'a direct call', '~~~'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not report a term inside an indented fence', () => {
    const markdown = ['- an item:', '', '  ```ts', '  a direct call', '  ```'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('closes a fence only with a fence of the same indent', () => {
    const markdown = ['- an item:', '', '  ```ts', '  one', '```', 'a direct call', '  ```'].join(
      '\n',
    );

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('reports a term in the prose between two fenced blocks', () => {
    const markdown = ['```ts', 'one', '```', 'a direct call', '```ts', 'two', '```'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 4, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('does not report a term inside a link destination', () => {
    const markdown = 'See [the doc](<./a direct call.md>) here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not read a term that begins at the end of a bare URL', () => {
    const markdown = 'See https://example.com/a/direct call here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not report a term after a three-backtick line inside a four-backtick fence', () => {
    const markdown = ['````md', '```', 'a direct call', '```', 'a direct call', '````'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('does not report a term inside indented code', () => {
    const markdown = ['A paragraph.', '', '    a direct call', '', 'The end.'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it.each([
    ['a block one', 'A paragraph.\n\n<!-- a direct call -->\n\nThe end.\n'],
    ['a block one over lines', 'A paragraph.\n\n<!--\na direct call\n-->\n\nThe end.\n'],
    ['an inline one', 'A paragraph <!-- a direct call --> goes on.\n'],
  ])('does not report a term inside an HTML comment, %s', (_form, markdown) => {
    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it.each([
    ['an autolink', 'See <https://example.com/direct> call here.\n'],
    ['a www link', 'See www.example.com/direct call here.\n'],
    ['a bare URL', 'See https://example.com/direct call here.\n'],
  ])('does not read a term that begins at the end of %s', (_form, markdown) => {
    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('reports a term in the second paragraph of a blockquote at its line', () => {
    const markdown = ['> One.', '>', '> A direct call', '> here.'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 3, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('reports a term in a nested list item at its line, whatever its parent wraps over', () => {
    const markdown = ['- one', '  two', '  - a direct', '    call', '- three'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 3, written: 'direct call', spelled: 'Direct call' }]);
  });

  it.each([
    ['two spaces', 'A direct  \ncall that wraps.\n'],
    ['a backslash', 'A direct\\\ncall that wraps.\n'],
  ])(
    'reports a term whose words a hard line break of %s separates, at the line it starts on',
    (_form, markdown) => {
      const misspellings = misspelledTerms(`First.\n\n${markdown}`, ['Direct call']);

      expect(misspellings).toEqual([{ line: 3, written: 'direct call', spelled: 'Direct call' }]);
    },
  );

  it.each([
    ['a code span before the break', 'the direct `x`\\\ncall'],
    ['a paragraph boundary before the break', 'Some direct\n\n`x`\\\ncall'],
    ['a code block before the break', 'a direct\n\n```\nq\n```\n\n`y`  \ncall'],
    ['emphasis before the break', '*direct*\\\ncall'],
    ['a link before the break', '[direct](u)  \ncall'],
  ])(
    'reports no term across %s, since only sibling text is joined by a hard line break',
    (_form, markdown) => {
      const misspellings = misspelledTerms(markdown, ['Direct call']);

      expect(misspellings).toEqual([]);
    },
  );

  it('reports a term that a hard line break splits inside emphasis', () => {
    const misspellings = misspelledTerms('*a direct  \ncall*', ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it.each([
    ['two spaces', 'Intro.  \nA direct call here.'],
    ['a backslash', 'Intro.\\\nA direct call here.'],
  ])(
    'reports a term after a line that ends in a hard line break of %s, at its own line',
    (_form, markdown) => {
      const misspellings = misspelledTerms(markdown, ['Direct call']);

      expect(misspellings).toEqual([{ line: 2, written: 'direct call', spelled: 'Direct call' }]);
    },
  );

  it('numbers the lines of a document with CRLF line ends as it does one with LF', () => {
    const lines = ['> One.', '>', '> A direct call', '', '- a direct', '  call'];

    const withCrlf = misspelledTerms(lines.join('\r\n'), ['Direct call']);
    const withLf = misspelledTerms(lines.join('\n'), ['Direct call']);

    expect(withCrlf).toEqual([
      { line: 3, written: 'direct call', spelled: 'Direct call' },
      { line: 5, written: 'direct call', spelled: 'Direct call' },
    ]);
    expect(withLf).toEqual(withCrlf);
  });

  it('reports a term in parentheses in prose', () => {
    const markdown = 'A Handler (a direct call) here.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('reports a term in link text and in a heading', () => {
    const markdown = '# A direct call\n\nSee [direct call](CONTEXT.md#direct-call).\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([
      { line: 1, written: 'direct call', spelled: 'Direct call' },
      { line: 3, written: 'direct call', spelled: 'Direct call' },
    ]);
  });

  it('does not match a term inside a hyphenated name', () => {
    const markdown = 'A direct-call, a non-breaking change, a direct call-site.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call', 'Breaking Change']);

    expect(misspellings).toEqual([]);
  });

  it('does not match a term inside a longer word', () => {
    const markdown = 'Some direct callers, a misdirect call.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('reads the longest term first, so Breaking Change Approval is not read as Breaking Change', () => {
    const markdown =
      'A breaking change approval, a Breaking Change Approval and a Breaking Change.\n';

    const misspellings = misspelledTerms(markdown, ['Breaking Change', 'Breaking Change Approval']);

    expect(misspellings).toEqual([
      { line: 1, written: 'breaking change approval', spelled: 'Breaking Change Approval' },
    ]);
  });

  it('keeps the line numbers after a fenced block', () => {
    const markdown = ['```ts', 'one', 'two', '```', 'a direct call'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 5, written: 'direct call', spelled: 'Direct call' }]);
  });

  it('reports each wrong spelling of every multi-word term of the glossary, and accepts its right ones', () => {
    const terms = termsOf(readFileSync(glossaryPath, 'utf8'));
    const wrong = terms.flatMap((term) => {
      const forms = [...new Set([term.toLowerCase(), titleCaseOf(term)])].filter(
        (form) => form !== term,
      );
      const singular = forms.map((written) => ({ written, spelled: term }));
      const plural = forms.map((written) => ({
        written: pluralOf(written),
        spelled: pluralOf(term),
      }));
      return [...singular, ...plural];
    });
    const right = terms.flatMap((term) => [term, pluralOf(term), `${term}'s`]);
    const markdown = [...wrong.map(({ written }) => written), ...right]
      .map((words) => `The ${words} here.`)
      .join('\n');

    const misspellings = misspelledTerms(markdown, terms);

    expect(misspellings).toEqual(wrong.map((use, index) => ({ line: index + 1, ...use })));
  });
});

/** The words of a term cut after the first, for a holder that puts the first in a URL and the rest after it. */
function splitOf(words: string): readonly [string, string] {
  const [first = '', ...rest] = words.split(' ');
  return [first, rest.join(' ')];
}

/** What can hold the words of a term: whether it is prose, so that a wrong spelling in it is reported. */
type Holder = {
  readonly isProse: boolean;
  /** The row of its lines that its words start on. */
  readonly row?: number;
  readonly lines: (words: string) => readonly string[];
};

const holders: Record<string, Holder> = {
  prose: { isProse: true, lines: (words) => [`The ${words} here.`] },
  'prose over a line break': {
    isProse: true,
    lines: (words) => [`The ${splitOf(words)[0]}`, `${splitOf(words)[1]} here.`],
  },
  'prose over a hard line break': {
    isProse: true,
    lines: (words) => [`The ${splitOf(words)[0]}  `, `${splitOf(words)[1]} here.`],
  },
  'prose after a hard line break': {
    isProse: true,
    row: 1,
    lines: (words) => ['An introduction.  ', `A ${words} here.`],
  },
  'prose after a backslash line break': {
    isProse: true,
    row: 1,
    lines: (words) => ['An introduction.\\', `A ${words} here.`],
  },
  'a code span before a hard line break': {
    isProse: false,
    lines: (words) => [`The ${splitOf(words)[0]} \`x\`\\`, `${splitOf(words)[1]} here.`],
  },
  'emphasis before a hard line break': {
    isProse: false,
    lines: (words) => [`The *${splitOf(words)[0]}*  `, `${splitOf(words)[1]} here.`],
  },
  'a paragraph boundary before a hard line break': {
    isProse: false,
    lines: (words) => [`The ${splitOf(words)[0]}`, '', '`x`\\', `${splitOf(words)[1]} here.`],
  },
  'prose over a backslash line break': {
    isProse: true,
    lines: (words) => [`The ${splitOf(words)[0]}\\`, `${splitOf(words)[1]} here.`],
  },
  'a code span': { isProse: false, lines: (words) => [`The \`${words}\` here.`] },
  'a double-backtick span': { isProse: false, lines: (words) => [`The \`\` ${words} \`\` here.`] },
  'a code span over a line break': {
    isProse: false,
    lines: (words) => [`The \`${splitOf(words)[0]}`, `${splitOf(words)[1]}\` here.`],
  },
  'a backtick fence': { isProse: false, lines: (words) => ['```ts', `// ${words}`, '```'] },
  'a tilde fence': { isProse: false, lines: (words) => ['~~~', words, '~~~'] },
  'a four-backtick fence after a three-backtick line': {
    isProse: false,
    lines: (words) => ['````md', '```', words, '```', words, '````'],
  },
  'indented code': { isProse: false, lines: (words) => [`    ${words}`] },
  'an HTML comment block': { isProse: false, lines: (words) => [`<!-- ${words} -->`] },
  'an HTML comment block over lines': {
    isProse: false,
    lines: (words) => ['<!--', words, '-->'],
  },
  'an inline HTML comment': { isProse: false, lines: (words) => [`The <!-- ${words} --> here.`] },
  'a link destination': { isProse: false, lines: (words) => [`See [the doc](<./${words}.md>).`] },
  'a link title': { isProse: false, lines: (words) => [`See [the doc](./a.md "${words}").`] },
  'a definition': { isProse: false, lines: (words) => [`[the doc]: ./a.md "${words}"`] },
  'an autolink': {
    isProse: false,
    lines: (words) => [`See <https://example.com/${splitOf(words)[0]}> ${splitOf(words)[1]}.`],
  },
  'a bare URL': {
    isProse: false,
    lines: (words) => [`See https://example.com/${splitOf(words)[0]} ${splitOf(words)[1]}.`],
  },
  'a www link': {
    isProse: false,
    lines: (words) => [`See www.example.com/${splitOf(words)[0]} ${splitOf(words)[1]}.`],
  },
  'an HTML block': { isProse: false, lines: (words) => [`<summary>${words}</summary>`] },
};

const spellings = ['wrong', 'wrong plural', 'right', 'right plural', 'right possessive'] as const;

function spellingOf(term: string, spelling: (typeof spellings)[number], draw: Draw): string {
  const wrong = [term.toLowerCase(), titleCaseOf(term)].filter((form) => form !== term);
  const form = pickFrom(draw, wrong);
  switch (spelling) {
    case 'wrong':
      return form;
    case 'wrong plural':
      return pluralOf(form);
    case 'right':
      return term;
    case 'right plural':
      return pluralOf(term);
    case 'right possessive':
      return `${term}'s`;
  }
}

type Use = {
  readonly block: MarkdownBlock;
  readonly row: number;
  readonly expected: Omit<TermMisspelling, 'line'> | undefined;
};

function aUse(terms: readonly string[], draw: Draw): Use {
  const term = pickFrom(draw, terms);
  const spelling = pickFrom(draw, spellings);
  const holder = holders[pickFrom(draw, Object.keys(holders))] as Holder;
  const written = spellingOf(term, spelling, draw);
  const isWrong = spelling.startsWith('wrong');
  const spelled = spelling === 'wrong plural' ? pluralOf(term) : term;
  const expected = holder.isProse && isWrong ? { written, spelled } : undefined;
  const block = { lines: holder.lines(written), isParagraph: holder.isProse };
  return { block, row: holder.row ?? 0, expected };
}

/** A document of uses of terms in `container`, and the misspellings in its prose, by construction. */
function aDocument(
  terms: readonly string[],
  container: Container,
  draw: Draw,
): { markdown: string; expected: TermMisspelling[] } {
  const uses = Array.from({ length: 4 + Math.floor(draw() * 4) }, () => aUse(terms, draw));
  const lead: MarkdownBlock = { lines: ['An introduction.'], isParagraph: true };
  const laidOut = placed([lead, ...uses.map(({ block }) => block)], container, draw);
  const expected: TermMisspelling[] = [];
  for (const [index, { row, expected: use }] of uses.entries()) {
    if (use !== undefined) {
      expected.push({ line: (laidOut.starts[index + 1] as number) + row, ...use });
    }
  }
  return { markdown: laidOut.lines.join('\n'), expected };
}

describe('misspelledTerms over every holder in every container', () => {
  const terms = termsOf(readFileSync(glossaryPath, 'utf8'));

  it('reports each term exactly where it is misspelled in prose, at the line of its first word', () => {
    const draw = aSeededDraw(551);
    const wrong: string[] = [];
    for (const [name, container] of Object.entries(containers)) {
      for (let sample = 0; sample < 200; sample++) {
        const { markdown, expected } = aDocument(terms, container, draw);
        const reported = misspelledTerms(markdown, terms);
        if (JSON.stringify(reported) !== JSON.stringify(expected)) {
          wrong.push(
            `${name}: reported ${JSON.stringify(reported)} in ${JSON.stringify(markdown)}`,
          );
        }
      }
    }

    expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
  });
});

describe('node scripts/check-terms.ts', () => {
  it('names the document, the line and the term, and exits with status 1', async () => {
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Direct call**:\nCalling a Handler.\n',
      'README.md': 'Some prose.\nA direct call here.\n',
    });

    const run = await runCheckTerms(repositoryDir);

    expect(run).toEqual({
      status: 1,
      stderr: 'README.md:2 terms: write "Direct call", not "direct call".\n',
    });
  });

  it('writes the plural of the term when the document writes a plural', async () => {
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Broker prefix**:\nA name.\n',
      'README.md': 'Two broker prefixes.\n',
    });

    const run = await runCheckTerms(repositoryDir);

    expect(run.stderr).toBe('README.md:1 terms: write "Broker prefixes", not "broker prefixes".\n');
  });

  it('exits 0 when every term is spelled as the glossary spells it', async () => {
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Direct call**:\nCalling a Handler.\n',
      'README.md': 'A Direct call and a `direct call`.\n',
    });

    const run = await runCheckTerms(repositoryDir);

    expect(run).toEqual({ status: 0, stderr: '' });
  });

  it("reads the root documents and each package's README.md and ARCHITECTURE.md, and skips CHANGELOG.md", async () => {
    const wrong = 'A direct call.\n';
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Direct call**:\nCalling a Handler.\n',
      'WORKFLOW.md': wrong,
      'packages/tool/README.md': wrong,
      'packages/tool/ARCHITECTURE.md': wrong,
      'packages/tool/CHANGELOG.md': wrong,
      'packages/tool/docs.md': wrong,
      '.changeset/note.md': wrong,
      '.claude/agents/agent.md': wrong,
    });

    const run = await runCheckTerms(repositoryDir);

    expect(run).toEqual({
      status: 1,
      stderr: [
        'WORKFLOW.md:1 terms: write "Direct call", not "direct call".',
        'packages/tool/ARCHITECTURE.md:1 terms: write "Direct call", not "direct call".',
        'packages/tool/README.md:1 terms: write "Direct call", not "direct call".',
        '',
      ].join('\n'),
    });
  });
});
