import { describe, expect, it } from 'vitest';
import {
  aSeededDraw,
  type Container,
  containers,
  type Block as MarkdownBlock,
  pickFrom,
  placed,
} from './markdown-containers.ts';
import { type Block, blocksOf } from './readme-blocks.ts';

const readmePath = 'packages/contract/README.md';

function blocksIn(markdown: string): Block[] {
  return blocksOf({ path: readmePath, markdown }).blocks;
}

function summaryOf({ line, path, source }: Block): { line: number; path: string; source: string } {
  return { line, path, source };
}

describe('blocksOf', () => {
  it('reads a tilde block, a four-backtick block holding a three-backtick line and a block in a quote', () => {
    const markdown = [
      '# Declaring',
      '',
      '~~~ts',
      '// src/a.ts',
      'export const a = 1;',
      '~~~',
      '',
      '````ts',
      '// src/b.ts',
      '```',
      'export const b = 2;',
      '````',
      '',
      '> ```ts',
      '> // src/c.ts',
      '> export const c = 3;',
      '> ```',
    ].join('\n');

    const blocks = blocksIn(markdown);

    expect(blocks.map(summaryOf)).toEqual([
      { line: 4, path: 'src/a.ts', source: '// src/a.ts\nexport const a = 1;' },
      { line: 9, path: 'src/b.ts', source: '// src/b.ts\n```\nexport const b = 2;' },
      { line: 15, path: 'src/c.ts', source: '// src/c.ts\nexport const c = 3;' },
    ]);
  });

  it('does not read a heading inside a tilde fence as the anchor of a later snippet', () => {
    const markdown = [
      '# Real',
      '',
      '~~~md',
      '# Not a heading',
      '~~~',
      '',
      '```ts',
      'export const a = 1;',
      '```',
    ].join('\n');

    const blocks = blocksIn(markdown);

    expect(blocks.map(({ path }) => path)).toEqual(['snippets/contract-real.ts']);
  });

  it('names a snippet under a setext heading after that heading', () => {
    const markdown = [
      'Declaring Rejections',
      '====================',
      '',
      '```ts',
      'export const a = 1;',
      '```',
      '',
      'Handling',
      '--------',
      '',
      '```ts',
      'export const b = 2;',
      '```',
    ].join('\n');

    const blocks = blocksIn(markdown);

    expect(blocks.map(({ path }) => path)).toEqual([
      'snippets/contract-declaring-rejections.ts',
      'snippets/contract-handling.ts',
    ]);
  });

  it('reads a block never closed up to the end of what holds it', () => {
    const markdown = [
      '> ```ts',
      '> export const a = 1;',
      '',
      'Prose.',
      '',
      '```ts',
      'const b = 2;',
    ].join('\n');

    const blocks = blocksIn(markdown);

    expect(blocks.map(summaryOf)).toEqual([
      { line: 2, path: 'snippets/contract.ts', source: 'export const a = 1;' },
      { line: 7, path: 'snippets/contract-2.ts', source: 'const b = 2;' },
    ]);
  });

  it('does not read indented code, a block in an HTML block, or a block of another language', () => {
    const markdown = [
      'Text.',
      '',
      '    ```ts',
      '    export const a = 1;',
      '    ```',
      '',
      '<div>',
      '```ts',
      'export const b = 2;',
      '```',
      '</div>',
      '',
      '```tsx',
      'export const c = 3;',
      '```',
      '',
      '```TS',
      'export const d = 4;',
      '```',
    ].join('\n');

    const blocks = blocksIn(markdown);

    expect(blocks).toEqual([]);
  });

  it('numbers the lines of a README with CRLF line ends as it does one with LF', () => {
    const lines = ['> Text.', '>', '> ```ts', '> // src/a.ts', '> export const a = 1;', '> ```'];

    const withCrlf = blocksIn(lines.join('\r\n'));
    const withLf = blocksIn(lines.join('\n'));

    expect(withLf.map(summaryOf)).toEqual([
      { line: 4, path: 'src/a.ts', source: '// src/a.ts\nexport const a = 1;' },
    ]);
    expect(withCrlf).toEqual(withLf);
  });
});

type Draw = () => number;

const fences = ['```', '````', '`````', '~~~', '~~~~'] as const;
const languages = ['ts', 'typescript', 'ts title="a.ts"', 'tsx', 'TS', 'js', ''] as const;
const indents = [0, 1, 2, 3, 4] as const;

/** A file of a block's code as drawn: its lines and the row of the code it starts on, with its path when it names one. */
type DrawnFile = {
  readonly lines: readonly string[];
  readonly row: number;
  readonly path: string | undefined;
};

/** A block of Markdown, the files its code holds and where its first code line is, and whether it is read. */
type Drawn = {
  readonly block: MarkdownBlock;
  readonly files: readonly DrawnFile[];
  readonly codeRow: number;
  readonly isRead: boolean;
};

/** What `blocksOf` gives of a file, its path only when the file names one. */
type Shown = { line: number; named: boolean; path: string | undefined; source: string };

function isTypeScript(language: string): boolean {
  return language === 'ts' || language === 'typescript' || language.startsWith('ts ');
}

describe('blocksOf over every fence and container', () => {
  const draw: Draw = aSeededDraw(551);
  const used = {
    fences: new Set<string>(),
    languages: new Set<string>(),
    indents: new Set<number>(),
  };
  let filesDrawn = 0;

  function aFile(row: number, isNamed: boolean): DrawnFile {
    filesDrawn += 1;
    const path = `src/file${filesDrawn}.ts`;
    const code = `export const value${filesDrawn} = ${Math.floor(draw() * 10)};`;
    return isNamed
      ? { lines: [`// ${path}`, code], row, path }
      : { lines: [code], row, path: undefined };
  }

  /** One to three files, each after a blank line; those after the first name a path, or they would be one file with it. */
  function aCode(isSingleFile: boolean): { lines: string[]; files: DrawnFile[] } {
    const lines: string[] = [];
    const files: DrawnFile[] = [];
    const count = isSingleFile ? 1 : 1 + Math.floor(draw() * 3);
    for (let index = 0; index < count; index++) {
      const file = aFile(lines.length + (index > 0 ? 1 : 0), index > 0 || draw() < 0.5);
      if (index > 0) {
        lines.push('');
      }
      for (const row of file.lines) {
        lines.push(row);
      }
      files.push(file);
    }
    return { lines, files };
  }

  /** A tilde fence indented by 1 to 3 spaces keeps them in the code `marked` gives, so only a backtick fence is. */
  function anIndent(mark: string, canBeIndented: boolean): number {
    // TODO(#619): draw an indented tilde fence once marked takes its indentation out
    const indent = canBeIndented ? pickFrom(draw, indents) : 0;
    return mark.startsWith('~') && indent < 4 ? 0 : indent;
  }

  function aFencedBlock(canBeIndented: boolean): Drawn {
    const mark = pickFrom(draw, fences);
    const indent = anIndent(mark, canBeIndented);
    const language = pickFrom(draw, languages);
    const isInHtml = draw() < 0.25;
    const { lines, files } = aCode(isInHtml);
    used.fences.add(mark);
    used.languages.add(language);
    used.indents.add(indent);
    const pad = ' '.repeat(indent);
    const fenced = [
      `${pad}${mark}${language}`,
      ...lines.map((row) => `${pad}${row}`),
      `${pad}${mark}`,
    ];
    const wrapped = isInHtml ? ['<div>', ...fenced, '</div>'] : fenced;
    const isRead = indent < 4 && !isInHtml && isTypeScript(language);
    return {
      block: { lines: wrapped, isParagraph: false },
      files,
      codeRow: isInHtml ? 2 : 1,
      isRead,
    };
  }

  function anotherBlock(): Drawn {
    const forms = [['A paragraph.'], ['## A heading'], ['```json', '{}', '```'], ['> A quote.']];
    return {
      block: { lines: pickFrom(draw, forms), isParagraph: false },
      files: [],
      codeRow: 0,
      isRead: false,
    };
  }

  function aReadme(container: Container): { markdown: string; expected: Shown[] } {
    const lead: Drawn = {
      block: { lines: ['Text.'], isParagraph: true },
      files: [],
      codeRow: 0,
      isRead: false,
    };
    const hasLead = container.needsText || draw() < 0.5;
    const length = 2 + Math.floor(draw() * 3);
    const drawn = Array.from({ length }, (_, index) => {
      const canBeIndented = hasLead || !container.hasMarker || index > 0;
      return draw() < 0.7 ? aFencedBlock(canBeIndented) : anotherBlock();
    });
    const all = hasLead ? [lead, ...drawn] : drawn;
    const laidOut = placed(
      all.map(({ block }) => block),
      container,
      draw,
    );
    const expected: Shown[] = [];
    for (const [index, { files, codeRow, isRead }] of all.entries()) {
      for (const file of isRead ? files : []) {
        const line = (laidOut.starts[index] as number) + codeRow + file.row;
        expected.push({
          line,
          named: file.path !== undefined,
          path: file.path,
          source: file.lines.join('\n'),
        });
      }
    }
    return { markdown: laidOut.lines.join('\n'), expected };
  }

  function shownOf({ line, named, path, source }: Block): Shown {
    return { line, named, path: named ? path : undefined, source };
  }

  it('reads every TypeScript block of every fence and container at its lines, and no other block', () => {
    const wrong: string[] = [];
    const usable = Object.entries(containers).filter(([, container]) => !container.hasTab);
    for (const [name, container] of usable) {
      for (let sample = 0; sample < 400; sample++) {
        const { markdown, expected } = aReadme(container);
        const { blocks, problems } = blocksOf({ path: readmePath, markdown });
        const shown = blocks.map(shownOf);
        if (problems.length > 0 || JSON.stringify(shown) !== JSON.stringify(expected)) {
          wrong.push(`${name}: read ${JSON.stringify(shown)} of ${JSON.stringify(markdown)}`);
        }
      }
    }

    expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
    expect(used).toEqual({
      fences: new Set(fences),
      languages: new Set(languages),
      indents: new Set(indents),
    });
  });
});
