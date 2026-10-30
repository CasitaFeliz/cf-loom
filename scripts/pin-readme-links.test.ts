import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pinnedReadme, repositoryOf } from './pin-readme-links.ts';

const repository = 'CasitaFeliz/cf-loom';
const commit = '0123456789abcdef0123456789abcdef01234567';
const atMain = `https://github.com/${repository}/blob/main`;
const atCommit = `https://github.com/${repository}/blob/${commit}`;

const checkouts: string[] = [];

afterEach(() => {
  for (const checkout of checkouts.splice(0)) {
    rmSync(checkout, { recursive: true, force: true });
  }
});

function aCheckoutWith(files: Record<string, string>): string {
  const checkout = mkdtempSync(join(tmpdir(), 'pin-readme-links-'));
  checkouts.push(checkout);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true });
    writeFileSync(join(checkout, path), text);
  }
  return checkout;
}

function filesOf(checkout: string): Record<string, string> {
  const paths = readdirSync(checkout, { recursive: true, encoding: 'utf8' }).sort();
  const files = paths.filter((path) => statSync(join(checkout, path)).isFile());
  return Object.fromEntries(
    files.map((path) => [path, readFileSync(join(checkout, path), 'utf8')]),
  );
}

function manifestOf(url: string): string {
  return JSON.stringify({ repository: { type: 'git', url } });
}

function runPin(checkout: string, ...args: string[]): { status: number | null; stderr: string } {
  const script = join(import.meta.dirname, 'pin-readme-links.ts');
  const run = spawnSync('node', [script, ...args], { cwd: checkout, encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr };
}

function refusedLinesOf(readme: string): number[] {
  const pinned = pinnedReadme(readme, repository, commit);
  return pinned.kind === 'refused' ? pinned.problems.map(({ line }) => line) : [];
}

describe('pinnedReadme', () => {
  it('points a link to a repository file at main at the commit, keeping its path and anchor', () => {
    const readme = `See [the rule](${atMain}/COMPATIBILITY.md#not-allowed-in-a-contract).`;

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'pinned',
      text: `See [the rule](${atCommit}/COMPATIBILITY.md#not-allowed-in-a-contract).`,
    });
  });

  it('pins every such link of a README, several on one line and one inside a code block', () => {
    const readme = [
      `[one](${atMain}/CONTEXT.md) and [two](${atMain}/COMPATIBILITY.md#rules), [three](${atMain}/SNAPSHOT.md)`,
      '',
      '```md',
      `[in a block](${atMain}/ARCHITECTURE.md#runtime)`,
      '```',
    ].join('\n');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'pinned',
      text: [
        `[one](${atCommit}/CONTEXT.md) and [two](${atCommit}/COMPATIBILITY.md#rules), [three](${atCommit}/SNAPSHOT.md)`,
        '',
        '```md',
        `[in a block](${atCommit}/ARCHITECTURE.md#runtime)`,
        '```',
      ].join('\n'),
    });
  });

  it.each([
    [
      'a link to another repository',
      `[x](https://github.com/CasitaFeliz/other/blob/main/README.md)`,
    ],
    [
      'a link to a repository whose name starts with its own',
      `[x](https://github.com/CasitaFeliz/cf-loom-x/blob/main/README.md)`,
    ],
    ['an anchor link', '[x](#not-allowed-in-a-contract)'],
    [
      'a link to another host',
      '[names](https://fetch.spec.whatwg.org/#forbidden-request-header) and [docs](https://zod.dev/api)',
    ],
    [
      'prose and code with no repository reference',
      'Run `cf-loom verify`.\n\n```ts\nconst a = pinned(1);\n```',
    ],
  ])('leaves %s as it is', (_name, readme) => {
    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({ kind: 'pinned', text: readme });
  });

  it('matches the repository literally, so its dot is no wildcard', () => {
    const readme = [
      `[other](https://github.com/axb/c/blob/main/x.md)`,
      `[own](https://github.com/a.b/c/blob/main/x.md)`,
    ].join('\n');

    const pinned = pinnedReadme(readme, 'a.b/c', commit);

    expect(pinned).toEqual({
      kind: 'pinned',
      text: [
        `[other](https://github.com/axb/c/blob/main/x.md)`,
        `[own](https://github.com/a.b/c/blob/${commit}/x.md)`,
      ].join('\n'),
    });
  });

  it.each([
    ['a bare repository link', `[x](https://github.com/${repository}#readme)`],
    ['blob/main with no path', `[x](https://github.com/${repository}/blob/main)`],
    ['blob/main/ with an empty path', `[x](${atMain}/)`],
    ['tree/main with no path', `[x](https://github.com/${repository}/tree/main)`],
    ['tree/main with a path', `[x](https://github.com/${repository}/tree/main/packages)`],
    [
      'another case of the repository',
      `[x](https://github.com/casitafeliz/cf-loom/blob/main/CONTEXT.md)`,
    ],
    ['blob/HEAD', `[x](https://github.com/${repository}/blob/HEAD/CONTEXT.md)`],
    ['http instead of https', `[x](http://github.com/${repository}/blob/main/CONTEXT.md)`],
    ['www.github.com', `[x](https://www.github.com/${repository}/blob/main/CONTEXT.md)`],
    [
      'raw.githubusercontent.com',
      `[x](https://raw.githubusercontent.com/${repository}/main/CONTEXT.md)`,
    ],
    ['a link target with a title', `[x](${atMain}/CONTEXT.md "the glossary")`],
    ['an autolink', `<${atMain}/CONTEXT.md>`],
    ['an HTML link', `<a href="${atMain}/CONTEXT.md">x</a>`],
    ['the repository named in prose', `The documents of ${repository} are on GitHub.`],
    ['a relative link up', '[x](../../COMPATIBILITY.md)'],
    ['a relative link here', '[x](./COMPATIBILITY.md)'],
    ['a relative link by name', '[x](COMPATIBILITY.md#rules)'],
  ])('refuses %s, naming its line', (_form, offending) => {
    const readme = [`[ok](${atMain}/CONTEXT.md)`, '', offending].join('\n');

    const refused = refusedLinesOf(readme);

    expect(refused).toEqual([3]);
  });

  it('says what is wrong on every offending line when a README has several', () => {
    const readme = ['[x](../up.md)', `[ok](${atMain}/CONTEXT.md)`, `<${atMain}/CONTEXT.md>`].join(
      '\n',
    );

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 1, problem: expect.stringContaining('../up.md') },
        { line: 3, problem: expect.stringContaining(repository) },
      ],
    });
  });
});

describe('repositoryOf', () => {
  it('returns owner and name from the repository URL of a package manifest', () => {
    const manifest = {
      repository: { type: 'git', url: 'git+https://github.com/CasitaFeliz/cf-loom.git' },
    };

    const repository = repositoryOf(manifest);

    expect(repository).toBe('CasitaFeliz/cf-loom');
  });

  it('keeps a dot of the name', () => {
    const manifest = { repository: { url: 'git+https://github.com/some-org/site.js.git' } };

    const repository = repositoryOf(manifest);

    expect(repository).toBe('some-org/site.js');
  });

  it.each([
    ['no repository', {}],
    [
      'a repository that is a string',
      { repository: 'git+https://github.com/CasitaFeliz/cf-loom.git' },
    ],
    ['a repository with no url', { repository: { type: 'git' } }],
    ['a url that is not a string', { repository: { url: 42 } }],
    ['another host', { repository: { url: 'git+https://gitlab.com/CasitaFeliz/cf-loom.git' } }],
    ['a url with no .git', { repository: { url: 'git+https://github.com/CasitaFeliz/cf-loom' } }],
    ['the github: shorthand', { repository: { url: 'github:CasitaFeliz/cf-loom' } }],
    ['an ssh url', { repository: { url: 'git@github.com:CasitaFeliz/cf-loom.git' } }],
    [
      'a url with a path in the repository',
      { repository: { url: 'git+https://github.com/CasitaFeliz/cf-loom/x.git' } },
    ],
  ])('names no repository for a manifest with %s', (_case, manifest) => {
    const repository = repositoryOf(manifest);

    expect(repository).toBeUndefined();
  });
});

describe('pin-readme-links', () => {
  it('pins each package README with its own repository and leaves every other file as it is', () => {
    const own = 'git+https://github.com/CasitaFeliz/cf-loom.git';
    const checkout = aCheckoutWith({
      'README.md': `[root](${atMain}/CONTEXT.md)`,
      'packages/a/package.json': manifestOf(own),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/a/ARCHITECTURE.md': `[architecture](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': manifestOf('git+https://github.com/other/b-repo.git'),
      'packages/b/README.md': '[b](https://github.com/other/b-repo/blob/main/x.md#y)',
      'packages/no-readme/package.json': manifestOf(own),
    });
    const before = filesOf(checkout);

    const run = runPin(checkout, commit);

    expect(run).toEqual({ status: 0, stderr: '' });
    expect(filesOf(checkout)).toEqual({
      ...before,
      'packages/a/README.md': `[a](${atCommit}/CONTEXT.md)`,
      'packages/b/README.md': `[b](https://github.com/other/b-repo/blob/${commit}/x.md#y)`,
    });
  });

  it('prints the file and line of each README it refuses and writes none', () => {
    const own = manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git');
    const checkout = aCheckoutWith({
      'packages/a/package.json': own,
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': own,
      'packages/b/README.md': `[b](${atMain}/CONTEXT.md)\n[up](../up.md)`,
      'packages/c/package.json': own,
      'packages/c/README.md': `\n\n<${atMain}/CONTEXT.md>`,
    });
    const before = filesOf(checkout);

    const run = runPin(checkout, commit);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('packages/b/README.md: line 2: ');
    expect(run.stderr).toContain('packages/c/README.md: line 3: ');
    expect(filesOf(checkout)).toEqual(before);
  });

  it('prints the manifest of a package that declares no GitHub repository and writes none', () => {
    const checkout = aCheckoutWith({
      'packages/a/package.json': manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git'),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': JSON.stringify({ name: 'b' }),
      'packages/b/README.md': '',
    });
    const before = filesOf(checkout);

    const run = runPin(checkout, commit);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('packages/b/package.json: repository.url must be ');
    expect(filesOf(checkout)).toEqual(before);
  });

  it('fails and writes nothing when a manifest is not JSON', () => {
    const checkout = aCheckoutWith({
      'packages/a/package.json': manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git'),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': '{ not json',
      'packages/b/README.md': '',
    });
    const before = filesOf(checkout);

    const run = runPin(checkout, commit);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SyntaxError');
    expect(filesOf(checkout)).toEqual(before);
  });

  it.each([
    ['missing', []],
    ['empty', ['']],
    ['short', ['0123456']],
    ['upper-case', [commit.toUpperCase()]],
    ['39 digits', [commit.slice(1)]],
    ['41 digits', [`${commit}0`]],
    ['not hexadecimal', [`${commit.slice(1)}g`]],
    ['a branch name', ['main']],
  ])('prints its usage and writes nothing when the commit is %s', (_case, args) => {
    const checkout = aCheckoutWith({
      'packages/a/package.json': manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git'),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
    });
    const before = filesOf(checkout);

    const run = runPin(checkout, ...args);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^usage: node scripts\/pin-readme-links\.ts <commit>/);
    expect(filesOf(checkout)).toEqual(before);
  });
});

describe('the package READMEs', () => {
  const root = join(import.meta.dirname, '..');
  const packageNames = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  function countOf(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }

  it.each(packageNames)(
    'of %s are pinned to a commit with none of its links left at main',
    (name) => {
      const folder = join(root, 'packages', name);
      const readme = readFileSync(join(folder, 'README.md'), 'utf8');
      const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
      const named = repositoryOf(manifest);
      const links = countOf(readme, `github.com/${named}`);

      const pinned = pinnedReadme(readme, named, commit);
      const text = pinned.kind === 'pinned' ? pinned.text : '';

      expect(countOf(text, `github.com/${named}/blob/${commit}/`)).toBe(links);
      expect(countOf(text, `github.com/${named}/blob/main`)).toBe(0);
    },
  );
});
