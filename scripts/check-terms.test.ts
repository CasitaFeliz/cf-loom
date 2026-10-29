import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { misspelledTerms, multiWordTerms } from './check-terms.ts';

const repositoryDirs: string[] = [];

const glossaryPath = join(import.meta.dirname, '..', 'CONTEXT.md');

function aRepositoryWith(files: Record<string, string>): string {
  const repositoryDir = mkdtempSync(join(tmpdir(), 'check-terms-'));
  repositoryDirs.push(repositoryDir);
  writeFileSync(join(repositoryDir, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(import.meta.dirname, join(repositoryDir, 'scripts'), {
    recursive: true,
    filter: (path) => !path.endsWith('.test.ts'),
  });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repositoryDir, path)), { recursive: true });
    writeFileSync(join(repositoryDir, path), content);
  }
  return repositoryDir;
}

function runCheckTerms(repositoryDir: string): { status: number | null; stderr: string } {
  const run = spawnSync('node', ['scripts/check-terms.ts'], {
    cwd: repositoryDir,
    encoding: 'utf8',
  });
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

    expect(misspellings).toEqual([{ line: 2, written: 'direct call', term: 'Direct call' }]);
  });

  it('reports a plural written in lower case and a half-capitalized term', () => {
    const markdown = 'Two direct calls.\nA Breaking change.\nSeveral broker prefixes.\n';

    const misspellings = misspelledTerms(markdown, [
      'Direct call',
      'Breaking Change',
      'Broker prefix',
    ]);

    expect(misspellings).toEqual([
      { line: 1, written: 'direct calls', term: 'Direct call' },
      { line: 2, written: 'Breaking change', term: 'Breaking Change' },
      { line: 3, written: 'broker prefixes', term: 'Broker prefix' },
    ]);
  });

  it('reports a term whose words a line break separates, at the line it starts on', () => {
    const markdown =
      'A long sentence about a direct\ncall that wraps, and a Direct\ncall that is right.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 1, written: 'direct call', term: 'Direct call' }]);
  });

  it('does not report a term inside code, a fenced block, a tilde fence, an indented fence or a link destination', () => {
    const markdown = [
      'A `direct call` in a span.',
      '```ts',
      '// a direct call',
      '```',
      '~~~',
      'a direct call',
      '~~~',
      '- an item:',
      '',
      '  ```ts',
      '  a direct call',
      '  ```',
      '',
      'See [the doc](https://example.com/direct call.md) and https://example.com/direct-call/direct call',
    ].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([]);
  });

  it('reports a term in link text and in a heading', () => {
    const markdown = '# A direct call\n\nSee [direct call](CONTEXT.md#direct-call).\n';

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([
      { line: 1, written: 'direct call', term: 'Direct call' },
      { line: 3, written: 'direct call', term: 'Direct call' },
    ]);
  });

  it('does not match a hyphenated name or a longer word', () => {
    const markdown = 'A direct-call, a non-breaking change, direct callers, a misdirect call.\n';

    const misspellings = misspelledTerms(markdown, ['Direct call', 'Breaking Change']);

    expect(misspellings).toEqual([]);
  });

  it('reads the longest term first, so Breaking Change Approval is not read as Breaking Change', () => {
    const markdown =
      'A breaking change approval, a Breaking Change Approval and a Breaking Change.\n';

    const misspellings = misspelledTerms(markdown, ['Breaking Change', 'Breaking Change Approval']);

    expect(misspellings).toEqual([
      { line: 1, written: 'breaking change approval', term: 'Breaking Change Approval' },
    ]);
  });

  it('keeps the line numbers after a fenced block', () => {
    const markdown = ['```ts', 'one', 'two', '```', 'a direct call'].join('\n');

    const misspellings = misspelledTerms(markdown, ['Direct call']);

    expect(misspellings).toEqual([{ line: 5, written: 'direct call', term: 'Direct call' }]);
  });

  it('reports each wrong spelling of every multi-word term of the glossary, and accepts its right ones', () => {
    const terms = termsOf(readFileSync(glossaryPath, 'utf8'));
    const wrong = terms.flatMap((term) => {
      const forms = new Set([term.toLowerCase(), titleCaseOf(term)]);
      forms.delete(term);
      return [...forms, ...[...forms].map(pluralOf)].map((written) => ({ term, written }));
    });
    const right = terms.flatMap((term) => [term, pluralOf(term), `${term}'s`]);
    const markdown = [...wrong.map(({ written }) => written), ...right]
      .map((words) => `The ${words} here.`)
      .join('\n');

    const misspellings = misspelledTerms(markdown, terms);

    expect(misspellings).toEqual(wrong.map((use, index) => ({ line: index + 1, ...use })));
  });
});

describe('node scripts/check-terms.ts', () => {
  it('names the document, the line and the term, and exits with status 1', () => {
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Direct call**:\nCalling a Handler.\n',
      'README.md': 'Some prose.\nA direct call here.\n',
    });

    const run = runCheckTerms(repositoryDir);

    expect(run).toEqual({
      status: 1,
      stderr: 'README.md:2 terms: write "Direct call", not "direct call".\n',
    });
  });

  it('writes the plural of the term when the document writes a plural', () => {
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Broker prefix**:\nA name.\n',
      'README.md': 'Two broker prefixes.\n',
    });

    const run = runCheckTerms(repositoryDir);

    expect(run.stderr).toBe('README.md:1 terms: write "Broker prefixes", not "broker prefixes".\n');
  });

  it('exits 0 when every term is spelled as the glossary spells it', () => {
    const repositoryDir = aRepositoryWith({
      'CONTEXT.md': '**Direct call**:\nCalling a Handler.\n',
      'README.md': 'A Direct call and a `direct call`.\n',
    });

    const run = runCheckTerms(repositoryDir);

    expect(run).toEqual({ status: 0, stderr: '' });
  });

  it("reads the root documents and each package's README.md and ARCHITECTURE.md, and skips CHANGELOG.md", () => {
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

    const run = runCheckTerms(repositoryDir);

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
