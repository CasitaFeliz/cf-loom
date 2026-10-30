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
  /** Whether every test of the fixture passed. */
  readonly passed: boolean;
  /** The pids the stub servers logged, one each as they started. */
  readonly pids: readonly number[];
  /** The `-sd` stores the stub servers logged. */
  readonly stores: readonly string[];
};

/** What a stub server does: `silent` never listens, `serves` listens, `deaf` listens and ignores SIGTERM. */
type Stub = 'silent' | 'serves' | 'deaf';

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** This run's environment for a nested Vitest, without the variables that make it pick another reporter. */
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

/** Writes into `directory` an executable named `command` that runs the stub server in `mode`, logging to `logs`. */
async function writeStub(directory: string, command: string, mode: Stub): Promise<void> {
  const stub = join(fixtures, 'stub-server.ts');
  const logs = `"${join(directory, 'pids')}" "${join(directory, 'stores')}"`;
  const executable = join(directory, command);
  await writeFile(
    executable,
    `#!/bin/sh\nexec "${process.execPath}" "${stub}" ${mode} ${logs} "$@"\n`,
  );
  await chmod(executable, 0o755);
}

/** Runs `fixture` in a Vitest of its own, with `directory` first on PATH. */
function runVitestOn(fixture: string, directory: string): Promise<Pick<Run, 'output' | 'passed'>> {
  const { PATH: path = '' } = process.env;
  const env = {
    ...environmentWithout(['AI_AGENT', 'CLAUDECODE']),
    PATH: [directory, path].join(delimiter),
  };
  const args = [vitestCli, 'run', '--reporter=default', fixture];
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: fixtures, env }, (error, stdout, stderr) => {
      resolve({ output: `${stdout}\n${stderr}`, passed: error === null });
    });
  });
}

describe('a process a test spawns through test-process.ts', () => {
  const directories: string[] = [];

  /** Runs one fixture, with `stubs` on PATH as the executables they stand in for. */
  async function runFixture(fixture: string, stubs: Readonly<Record<string, Stub>>): Promise<Run> {
    const directory = await mkdtemp(join(tmpdir(), 'cf-loom-test-processes-'));
    directories.push(directory);
    for (const [command, mode] of Object.entries(stubs)) {
      await writeStub(directory, command, mode);
    }
    const finished = await runVitestOn(fixture, directory);
    const pids = (await linesOf(join(directory, 'pids'))).map(Number);
    return { ...finished, pids, stores: await linesOf(join(directory, 'stores')) };
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

    expect(run.passed).toBe(true);
    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
  });

  test('a process started outside any test or hook fails naming why', async () => {
    const run = await runFixture('outside-any-test.fixture.ts', {});

    expect(run.passed).toBe(false);
    expect(run.output).toContain('no test or hook owns');
  });
});
