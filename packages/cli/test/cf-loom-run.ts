import { execFile } from 'node:child_process';
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
