// biome-ignore-all lint/style/useNamingConvention: the environment variables of the Vitest run the fixtures need
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, test } from 'vitest';
import { aTemporaryDirectory, startProcess, type TestProcess } from './test-process.ts';

const fixtures = join(import.meta.dirname, 'test-processes');
const vitestCli = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

type Run = {
  /** The end of what the fixture's Vitest wrote to stdout and stderr. */
  readonly output: string;
  /** Whether every test of the fixture passed. */
  readonly passed: boolean;
  /** The pids the stub servers logged, one each as they started. */
  readonly pids: readonly number[];
  /** What the run left in its temporary directory. */
  readonly leftInTemporary: readonly string[];
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
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !names.includes(name) && !name.startsWith('VITEST')) {
      kept[name] = value;
    }
  }
  return kept;
}

async function linesOf(file: string): Promise<readonly string[]> {
  const written = await readFile(file, 'utf8').catch(() => '');
  return written.split('\n').filter((line) => line !== '');
}

/** Writes into `directory` an executable named `command` that runs the stub server in `mode`. */
async function writeStub(directory: string, command: string, mode: Stub): Promise<void> {
  const stub = join(fixtures, 'stub-server.ts');
  const executable = join(directory, command);
  await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "${stub}" ${mode}\n`);
  await chmod(executable, 0o755);
}

/** A fixture running in a Vitest of its own, and where it logs and leaves things. */
type Started = {
  readonly vitest: TestProcess;
  readonly pidsFile: string;
  readonly temporary: string;
};

/**
 * Starts one fixture in a Vitest of its own, with `stubs` on PATH as the executables they stand in for, a temporary
 * directory of its own, and the file the stubs log their pids to in `STUB_PIDS`.
 */
async function startFixture(
  fixture: string,
  stubs: Readonly<Record<string, Stub>>,
): Promise<Started> {
  const directory = aTemporaryDirectory('cf-loom-test-processes-');
  const temporary = join(directory, 'tmp');
  await mkdir(temporary);
  for (const [command, mode] of Object.entries(stubs)) {
    await writeStub(directory, command, mode);
  }
  const pidsFile = join(directory, 'pids');
  const env = {
    ...environmentWithout(['AI_AGENT', 'CLAUDECODE']),
    PATH: [directory, process.env['PATH'] ?? ''].join(delimiter),
    TMPDIR: temporary,
    STUB_PIDS: pidsFile,
  };
  const args = [vitestCli, 'run', '--reporter=default', fixture];
  const vitest = startProcess(process.execPath, args, { cwd: fixtures, env });
  return { vitest, pidsFile, temporary };
}

/** Runs one fixture in a Vitest of its own to its end; see `startFixture`. */
async function runFixture(fixture: string, stubs: Readonly<Record<string, Stub>>): Promise<Run> {
  const { vitest, pidsFile, temporary } = await startFixture(fixture, stubs);
  const exit = await vitest.exited;
  return {
    output: `${vitest.stdout()}\n${vitest.stderr()}`,
    passed: exit.status === 0,
    pids: (await linesOf(pidsFile)).map(Number),
    leftInTemporary: (await readdir(temporary)).filter((name) => name.startsWith('cf-loom-')),
  };
}

/** Resolves once `condition` holds; the test's timeout bounds it. */
async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  while (!(await condition())) {
    await sleep(20);
  }
}

describe('a process a test starts through test-process.ts', () => {
  test('a start still waiting when its test times out is killed, and its stderr is in the test’s output', async () => {
    const run = await runFixture('hang-in-test.fixture.ts', { moto_server: 'silent' });

    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
    expect(run.output).toContain('moto_server was still waiting to listen');
    expect(run.output).toContain('warming up');
  });

  test('a server started in a beforeEach is killed when its test ends, before the next test starts', async () => {
    const run = await runFixture('server-for-test.fixture.ts', { moto_server: 'serves' });

    expect(run.passed).toBe(true);
    expect(run.pids).toHaveLength(2);
  });

  test('a server that ignores SIGTERM, whose stop in afterEach times out, is killed when its owner ends', async () => {
    const run = await runFixture('hung-stop.fixture.ts', { moto_server: 'deaf' });

    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
    expect(run.output).toContain('Hook timed out');
  });

  test('a start still waiting when its beforeAll times out is killed at the end of the file, and its stderr is in the output', async () => {
    const run = await runFixture('hang-in-hook.fixture.ts', { 'nats-server': 'silent' });

    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
    expect(run.output).toContain('nats-server was still waiting to listen');
    expect(run.output).toContain('warming up');
  });

  test('a nats-server whose start is still waiting when its beforeAll times out leaves no temporary store', async () => {
    const run = await runFixture('hang-in-hook.fixture.ts', { 'nats-server': 'silent' });

    expect(run.pids).toHaveLength(1);
    expect(run.leftInTemporary).toEqual([]);
  });

  test('a server started in a beforeAll is alive in every test of its file and gone after the file', async () => {
    const run = await runFixture('server-for-file.fixture.ts', { moto_server: 'serves' });

    expect(run.passed).toBe(true);
    expect(run.pids).toHaveLength(1);
    expect(isRunning(run.pids[0]!)).toBe(false);
  });

  test('a process started outside any test or hook fails naming why', async () => {
    const run = await runFixture('process-outside-any-test.fixture.ts', {});

    expect(run.passed).toBe(false);
    expect(run.output).toContain('no test or hook owns');
  });

  test('a stub server is a child of the Vitest running its fixture, and ends when that is killed', async () => {
    const { vitest, pidsFile } = await startFixture('stuck-start.fixture.ts', {
      moto_server: 'silent',
    });
    await until(async () => (await linesOf(pidsFile)).length === 1);
    const [stub] = (await linesOf(pidsFile)).map(Number);
    const parent = startProcess('ps', ['-o', 'ppid=', '-p', String(stub)]);
    await parent.exited;

    expect(Number(parent.stdout())).toBe(vitest.child.pid);
    vitest.child.kill('SIGKILL');
    await vitest.exited;
    await until(() => !isRunning(stub!));
  });

  test('a nats-server started outside any test or hook fails before it creates its store', async () => {
    const run = await runFixture('nats-outside-any-test.fixture.ts', { 'nats-server': 'serves' });

    expect(run.output).toContain('no test or hook owns');
    expect(run.pids).toEqual([]);
    expect(run.leftInTemporary).toEqual([]);
  });
});
