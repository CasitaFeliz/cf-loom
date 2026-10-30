import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const configUrl = pathToFileURL(join(import.meta.dirname, '..', 'vitest.config.ts')).href;

/** A Vitest process: it loads the configuration, reports the folder the `tooling` project gets its README Service from, and lives until its stdin closes. */
const vitestProcess = `
const { default: config } = await import(${JSON.stringify(configUrl)});
const tooling = config.test.projects.find((project) => project.test?.name === 'tooling');
console.log(tooling.test.provide?.readmeService);
process.stdin.resume();
`;

type Started = {
  readonly folder: string;
  /** Ends the process by closing its stdin, and resolves once it has exited. */
  readonly stop: () => Promise<void>;
};

const started: { child: ChildProcess; folder: string }[] = [];

/** Starts a Vitest process, and resolves once it reports its README Service. */
function startVitestProcess(): Promise<Started> {
  const child = spawn('node', ['--input-type=module', '--eval', vitestProcess], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return new Promise((resolve, reject) => {
    let reported = '';
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.stdout.on('data', (chunk) => {
      reported += chunk;
      if (reported.includes('\n')) {
        const folder = reported.trim();
        started.push({ child, folder });
        resolve({
          folder,
          stop: () => {
            child.stdin.end();
            return exited;
          },
        });
      }
    });
    child.once('exit', (code) => {
      reject(new Error(`The Vitest process exited with ${code} before it reported:\n${errors}`));
    });
  });
}

afterEach(() => {
  for (const { child, folder } of started.splice(0)) {
    child.kill('SIGKILL');
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('the Vitest configuration', () => {
  test('Vitest processes started together in one checkout each write a README Service of their own, removed when they exit', async () => {
    const [first, second] = await Promise.all([startVitestProcess(), startVitestProcess()]);

    expect(first.folder).not.toBe(second.folder);
    expect(existsSync(join(first.folder, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(second.folder, 'tsconfig.json'))).toBe(true);

    await Promise.all([first.stop(), second.stop()]);

    expect(existsSync(first.folder)).toBe(false);
    expect(existsSync(second.folder)).toBe(false);
  });
});
