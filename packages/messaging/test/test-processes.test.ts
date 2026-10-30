// biome-ignore-all lint/style/useNamingConvention: the environment variables of the Vitest run the fixtures need
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const fixtures = join(import.meta.dirname, 'test-processes');
const vitestCli = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

type Run = {
  /** What the fixture's Vitest wrote to stdout and stderr. */
  readonly output: string;
  readonly exitCode: number;
  /** The pids the stub servers logged, one each as they started. */
  readonly pids: readonly number[];
  /** The `-sd` stores the stub servers logged. */
  readonly stores: readonly string[];
};

type Stub = 'silent' | 'serves' | 'deaf';

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The environment of this run for a nested Vitest, without the variables that make it pick another reporter. */
function environmentWithout(names: readonly string[]): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    ([name, value]) => value !== undefined && !names.includes(name) && !name.startsWith('VITEST'),
  );
  return Object.fromEntries(kept) as Record<string, string>;
}

async function linesOf(file: string): Promise<readonly string[]> {
  const written = await readFile(file, 'utf8').catch(() => '');
  return written.split('\n').filter((line) => line !== '');
}

describe('a process a test spawns through test-process.ts', () => {
  const directories: string[] = [];

  /** Runs one fixture in a Vitest of its own, with `stubs` on PATH as the executables they stand in for. */
  async function runFixture(fixture: string, stubs: Readonly<Record<string, Stub>>): Promise<Run> {
    const directory = await mkdtemp(join(tmpdir(), 'cf-loom-test-processes-'));
    directories.push(directory);
    const pidsFile = join(directory, 'pids');
    const storesFile = join(directory, 'stores');
    const stub = join(fixtures, 'stub-server.ts');
    for (const [command, mode] of Object.entries(stubs)) {
      const executable = join(directory, command);
      const script = `#!/bin/sh\nexec "${process.execPath}" "${stub}" ${mode} "${pidsFile}" "${storesFile}" "$@"\n`;
      await writeFile(executable, script);
      await chmod(executable, 0o755);
    }
    const { PATH: path = '' } = process.env;
    const env = {
      ...environmentWithout(['AI_AGENT', 'CLAUDECODE']),
      PATH: [directory, path].join(delimiter),
    };
    const args = [vitestCli, 'run', '--reporter=default', fixture];
    const finished = await new Promise<{ output: string; exitCode: number }>((resolve) => {
      execFile(process.execPath, args, { cwd: fixtures, env }, (error, stdout, stderr) => {
        resolve({ output: `${stdout}\n${stderr}`, exitCode: error === null ? 0 : 1 });
      });
    });
    const pids = (await linesOf(pidsFile)).map(Number);
    return { ...finished, pids, stores: await linesOf(storesFile) };
  }

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test('a start still waiting when its test times out is killed, and its stderr is in the test’s output', async () => {
    const run = await runFixture('hang-in-test.fixture.ts', { moto_server: 'silent' });

    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
    expect(run.output).toContain('moto_server');
    expect(run.output).toContain('warming up');
  });

  test('a server that ignores SIGTERM, whose stop in afterEach times out, is killed when its test ends', async () => {
    const run = await runFixture('hung-stop.fixture.ts', { moto_server: 'deaf' });

    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
    expect(run.output).toContain('Hook timed out');
  });

  test('a start still waiting when its beforeAll times out is killed at the end of the file, and its stderr is in the output', async () => {
    const run = await runFixture('hang-in-hook.fixture.ts', { 'nats-server': 'silent' });

    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
    expect(run.output).toContain('nats-server');
    expect(run.output).toContain('warming up');
  });

  test('a nats-server whose start is still waiting when its beforeAll times out leaves no temporary store', async () => {
    const run = await runFixture('hang-in-hook.fixture.ts', { 'nats-server': 'silent' });

    expect(run.stores).toHaveLength(1);
    await expect(stat(run.stores[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a server started in a beforeAll is alive in every test of its file and gone after the file', async () => {
    const run = await runFixture('server-for-file.fixture.ts', { moto_server: 'serves' });

    expect(run.exitCode).toBe(0);
    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
  });

  test('a process started outside any test or hook fails naming why', async () => {
    const run = await runFixture('outside-any-test.fixture.ts', {});

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('no test or hook owns');
  });
});
