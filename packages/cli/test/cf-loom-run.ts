import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import type { NpmEnvironment } from './npm-environment.ts';

/** The CLI's entry, which a test runs from source. */
export const bin = join(import.meta.dirname, '..', 'src', 'bin.ts');

/** How a run of the CLI ended: its exit status and what it printed. */
export type Ran = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs the CLI without blocking the test's event loop, so the lab's registry can answer npm. */
export function cfLoomWith(project: string, env: NpmEnvironment, ...args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const options = { cwd: project, env, encoding: 'utf8' } as const;
    execFile(process.execPath, [bin, ...args], options, (error, stdout, stderr) => {
      const status = error === null ? 0 : error.code;
      resolve({ status: typeof status === 'number' ? status : null, stdout, stderr });
    });
  });
}

/** Which stream of the CLI a reader closes, and when: before the CLI writes, after the first chunk it reads, or never. */
export type Closing = {
  readonly stream: 'stdout' | 'stderr';
  readonly when: 'before' | 'after' | 'never';
};

/** Runs the CLI with both streams piped to a reader that closes the one `closing` names, as `head -c 5` does. */
export function cfLoomClosing(project: string, closing: Closing, ...args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const read = { stdout: '', stderr: '' };
    for (const name of ['stdout', 'stderr'] as const) {
      const stream = child[name];
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        read[name] += chunk;
        if (closing.stream === name && closing.when === 'after') {
          stream.destroy();
        }
      });
    }
    if (closing.when === 'before') {
      child[closing.stream].destroy();
    }
    child.on('close', (status) => resolve({ status, ...read }));
  });
}
