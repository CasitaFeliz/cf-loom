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
import { runProcess } from '../packages/messaging/test/test-process.ts';
import { repositoryOf } from './pin-readme-links.ts';

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

async function runPin(
  checkout: string,
  ...args: string[]
): Promise<{ status: number; stderr: string }> {
  const script = join(import.meta.dirname, 'pin-readme-links.ts');
  const run = await runProcess('node', [script, ...args], { cwd: checkout });
  return { status: run.status, stderr: run.stderr };
}

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
  it('pins each package README with its own repository and leaves every other file as it is', async () => {
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

    const run = await runPin(checkout, commit);

    expect(run).toEqual({ status: 0, stderr: '' });
    expect(filesOf(checkout)).toEqual({
      ...before,
      'packages/a/README.md': `[a](${atCommit}/CONTEXT.md)`,
      'packages/b/README.md': `[b](https://github.com/other/b-repo/blob/${commit}/x.md#y)`,
    });
  });

  it('prints the file and line of each README it refuses and writes none', async () => {
    const own = manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git');
    const checkout = aCheckoutWith({
      'packages/a/package.json': own,
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': own,
      'packages/b/README.md': '[up](../up.md)\n[here](./here.md)',
      'packages/c/package.json': own,
      'packages/c/README.md': `\n\n<${atMain}/CONTEXT.md>`,
    });
    const before = filesOf(checkout);

    const run = await runPin(checkout, commit);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('packages/b/README.md: line 1: ');
    expect(run.stderr).toContain('packages/b/README.md: line 2: ');
    expect(run.stderr).toContain('packages/c/README.md: line 3: ');
    expect(filesOf(checkout)).toEqual(before);
  });

  it('prints the manifest of a package that declares no GitHub repository and writes none', async () => {
    const checkout = aCheckoutWith({
      'packages/a/package.json': manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git'),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': JSON.stringify({ name: 'b' }),
      'packages/b/README.md': '',
    });
    const before = filesOf(checkout);

    const run = await runPin(checkout, commit);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('packages/b/package.json: repository.url must be ');
    expect(filesOf(checkout)).toEqual(before);
  });

  it('fails and writes nothing when a manifest is not JSON', async () => {
    const checkout = aCheckoutWith({
      'packages/a/package.json': manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git'),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
      'packages/b/package.json': '{ not json',
      'packages/b/README.md': '',
    });
    const before = filesOf(checkout);

    const run = await runPin(checkout, commit);

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
  ])('prints its usage and writes nothing when the commit is %s', async (_case, args) => {
    const checkout = aCheckoutWith({
      'packages/a/package.json': manifestOf('git+https://github.com/CasitaFeliz/cf-loom.git'),
      'packages/a/README.md': `[a](${atMain}/CONTEXT.md)`,
    });
    const before = filesOf(checkout);

    const run = await runPin(checkout, ...args);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^usage: node scripts\/pin-readme-links\.ts <commit>/);
    expect(filesOf(checkout)).toEqual(before);
  });
});

describe('the package READMEs', () => {
  const packages = join(import.meta.dirname, '..', 'packages');

  function countOf(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }

  it('are all pinned to a commit by the command, with none of their links left at main', async () => {
    const copied: Record<string, string> = {};
    const linksByFolder: Record<string, number> = {};
    for (const folder of readdirSync(packages)) {
      const manifest = readFileSync(join(packages, folder, 'package.json'), 'utf8');
      const readme = readFileSync(join(packages, folder, 'README.md'), 'utf8');
      copied[`packages/${folder}/package.json`] = manifest;
      copied[`packages/${folder}/README.md`] = readme;
      linksByFolder[folder] = countOf(readme, `github.com/${repositoryOf(JSON.parse(manifest))}`);
    }
    const checkout = aCheckoutWith(copied);

    const run = await runPin(checkout, commit);

    const written = filesOf(checkout);
    const atCommit: Record<string, number> = {};
    const atMain: Record<string, number> = {};
    for (const folder of Object.keys(linksByFolder)) {
      const readme = written[`packages/${folder}/README.md`] ?? '';
      atCommit[folder] = countOf(readme, `/blob/${commit}/`);
      atMain[folder] = countOf(readme, '/blob/main');
    }
    expect(run).toEqual({ status: 0, stderr: '' });
    expect(atCommit).toEqual(linksByFolder);
    expect(atMain).toEqual(
      Object.fromEntries(Object.keys(linksByFolder).map((folder) => [folder, 0])),
    );
  });
});
