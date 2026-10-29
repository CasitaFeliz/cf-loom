import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectErrorProblems } from './check-expect-errors.ts';

const tsconfig = JSON.stringify({
  compilerOptions: {
    module: 'nodenext',
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: 'es2024',
    types: [],
  },
  include: ['src'],
});

const repositoryDir = join(import.meta.dirname, '..');
const tempDirs: string[] = [];

/** A directory that is removed after the test. */
function aTempDir(): string {
  const tempDir = mkdtempSync(join(realpathSync(tmpdir()), 'check-expect-errors-'));
  tempDirs.push(tempDir);
  return tempDir;
}

/** A project in `projectDir`: a `tsconfig.json` and, under `src/`, a file for each of `sources`. */
function writeProject(projectDir: string, sources: Record<string, string[]>): void {
  writeFileSync(join(projectDir, 'tsconfig.json'), tsconfig);
  for (const [name, lines] of Object.entries(sources)) {
    mkdirSync(dirname(join(projectDir, 'src', name)), { recursive: true });
    writeFileSync(join(projectDir, 'src', name), `${lines.join('\n')}\n`);
  }
}

function aProject(sources: Record<string, string[]>): string {
  const projectDir = aTempDir();
  writeProject(projectDir, sources);
  return projectDir;
}

/** The problems of the projects in `projectDirs`, by path relative to the first project. */
function problemsOf(...projectDirs: string[]) {
  const [first = ''] = projectDirs;
  const configPaths = projectDirs.map((projectDir) => join(projectDir, 'tsconfig.json'));
  return expectErrorProblems(configPaths).map(({ path, line, named, produced }) => ({
    file: relative(first, path),
    line,
    named,
    produced,
  }));
}

/** A repository with the script and `packages/tool`, a project of `sources`. */
function aRepositoryWith(sources: Record<string, string[]>): string {
  const repoDir = aTempDir();
  writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ type: 'module' }));
  symlinkSync(join(repositoryDir, 'node_modules'), join(repoDir, 'node_modules'));
  mkdirSync(join(repoDir, 'scripts'));
  cpSync(
    join(import.meta.dirname, 'check-expect-errors.ts'),
    join(repoDir, 'scripts', 'check-expect-errors.ts'),
  );
  const toolDir = join(repoDir, 'packages', 'tool');
  mkdirSync(toolDir, { recursive: true });
  writeProject(toolDir, sources);
  cpSync(join(toolDir, 'tsconfig.json'), join(toolDir, 'tsconfig.test.json'));
  return repoDir;
}

/** The TypeScript server sometimes prints `context canceled` as it stops, whatever the check found. */
function runCheck(cwd: string): { status: number | null; stderr: string } {
  const run = spawnSync('node', ['scripts/check-expect-errors.ts'], { cwd, encoding: 'utf8' });
  const stderr = run.stderr
    .split('\n')
    .filter((line) => line !== 'context canceled')
    .join('\n');
  return { status: run.status, stderr };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('expectErrorProblems', () => {
  it('accepts a directive that names the code its line fails with', () => {
    const projectDir = aProject({
      'refused.ts': ['// @ts-expect-error TS2322 a string is no number', "const n: number = 'x';"],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([]);
  });

  it('reports a bare directive with the code its line fails with', () => {
    const projectDir = aProject({
      'refused.ts': ['// @ts-expect-error a string is no number', "const n: number = 'x';"],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([
      { file: 'src/refused.ts', line: 1, named: undefined, produced: ['TS2322'] },
    ]);
  });

  it('reports a directive that names a code its line does not fail with', () => {
    const projectDir = aProject({
      'refused.ts': ['// @ts-expect-error TS2345 a string is no number', "const n: number = 'x';"],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([
      { file: 'src/refused.ts', line: 1, named: 'TS2345', produced: ['TS2322'] },
    ]);
  });

  it('reports a directive whose line does not fail', () => {
    const projectDir = aProject({
      'fine.ts': ['// @ts-expect-error TS2322 nothing is wrong here', 'const n: number = 1;'],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([{ file: 'src/fine.ts', line: 1, named: 'TS2322', produced: [] }]);
  });

  it('accepts a directive that names one of the codes its line fails with', () => {
    const projectDir = aProject({
      'two.ts': [
        "// @ts-expect-error TS2304 missing is no name\nconst pair: [number] = ['a', missing];",
      ],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([]);
  });

  it('lists every code a bare directive could name, ascending', () => {
    const projectDir = aProject({
      'two.ts': ["// @ts-expect-error both\nconst pair: [number] = ['a', missing];"],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([
      { file: 'src/two.ts', line: 1, named: undefined, produced: ['TS2304', 'TS2322'] },
    ]);
  });

  it('covers the line below past blank lines and line comments', () => {
    const projectDir = aProject({
      'refused.ts': [
        '// @ts-expect-error TS2322 a string is no number',
        '',
        '// The line below is the one that fails.',
        "const n: number = 'x';",
      ],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([]);
  });

  it('reports a directive over a line that does not fail, though a later line does', () => {
    const projectDir = aProject({
      'later.ts': [
        '// @ts-expect-error TS2322 a string is no number',
        'const fine = 1;',
        "const n: number = 'x';",
      ],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([{ file: 'src/later.ts', line: 1, named: 'TS2322', produced: [] }]);
  });

  it('reads the code only when it follows the directive', () => {
    const projectDir = aProject({
      'refused.ts': [
        '// @ts-expect-error a string is no number (TS2322)',
        "const n: number = 'x';",
      ],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([
      { file: 'src/refused.ts', line: 1, named: undefined, produced: ['TS2322'] },
    ]);
  });

  it('accepts a code followed by a colon', () => {
    const projectDir = aProject({
      'refused.ts': ['// @ts-expect-error TS2322: a string is no number', "const n: number = 'x';"],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([]);
  });

  it('does not take the text of a string for a directive', () => {
    const projectDir = aProject({
      'text.ts': ["export const text = '// @ts-expect-error';"],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([]);
  });

  it('checks a line against the declarations of the other files of the project', () => {
    const projectDir = aProject({
      'takes.ts': ['export declare function takes(count: number): void;'],
      'calls.ts': [
        "import { takes } from './takes.ts';",
        '// @ts-expect-error TS2345 a string is no count',
        "takes('x');",
      ],
    });

    const problems = problemsOf(projectDir);

    expect(problems).toEqual([]);
  });

  it('sorts the problems by file and line', () => {
    const bare = ['// @ts-expect-error', "const n: number = 'x';"];
    const projectDir = aProject({
      'b.ts': bare,
      'a.ts': [...bare, ...bare],
    });

    const problems = problemsOf(projectDir);

    expect(problems.map(({ file, line }) => `${file}:${line}`)).toEqual([
      'src/a.ts:1',
      'src/a.ts:3',
      'src/b.ts:1',
    ]);
  });

  it('reports the problems of every project it is given', () => {
    const bare = ['// @ts-expect-error', "const n: number = 'x';"];
    const first = aProject({ 'first.ts': bare });
    const second = aProject({ 'second.ts': bare });

    const problems = expectErrorProblems([
      join(first, 'tsconfig.json'),
      join(second, 'tsconfig.json'),
    ]);

    expect(problems.map(({ path }) => path).sort()).toEqual(
      [join(first, 'src', 'first.ts'), join(second, 'src', 'second.ts')].sort(),
    );
  });

  it('reports a directive once, though two projects include its file', () => {
    const projectDir = aProject({ 'bare.ts': ["// @ts-expect-error\nconst n: number = 'x';"] });
    writeFileSync(join(projectDir, 'again.json'), tsconfig);

    const problems = expectErrorProblems([
      join(projectDir, 'tsconfig.json'),
      join(projectDir, 'again.json'),
    ]);

    expect(problems).toHaveLength(1);
  });
});

describe('check-expect-errors', () => {
  it('passes a repository whose directives name the codes their lines fail with', () => {
    const repoDir = aRepositoryWith({
      'refused.ts': ['// @ts-expect-error TS2322 a string is no number', "const n: number = 'x';"],
    });

    const run = runCheck(repoDir);

    expect(run).toEqual({ status: 0, stderr: '' });
  });

  it('prints a problem as path, line and what the line fails with, and fails', () => {
    const repoDir = aRepositoryWith({
      'bare.ts': ['// @ts-expect-error a string is no number', "const n: number = 'x';"],
      'wrong.ts': ['// @ts-expect-error TS2345 a string is no number', "const n: number = 'x';"],
    });

    const run = runCheck(repoDir);

    expect(run).toEqual({
      status: 1,
      stderr: [
        'packages/tool/src/bare.ts:1 C23: a @ts-expect-error names the error it expects, TS<code> before its reason; the line below fails with TS2322.',
        'packages/tool/src/wrong.ts:1 C23: the line below fails with TS2322, not TS2345.',
        '',
      ].join('\n'),
    });
  });
});
