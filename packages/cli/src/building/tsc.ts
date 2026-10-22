import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installedManifestOf } from '../loading/index.ts';

const execFileAsync = promisify(execFile);
const tscTimeoutMilliseconds = 10 * 60 * 1000;
const maxOutputBytes = 16 * 1024 * 1024;

/** What `tsc -p` builds: a staged folder, the root file whose project's TypeScript builds it, and the package it is of. */
export type Building = {
  readonly folder: string;
  readonly rootPath: string;
  readonly spec: string;
};

/** The folder built, or why it was not, in one line. */
export type Built =
  | { readonly kind: 'built' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Builds a staged Contract Package with `tsc -p`, the TypeScript installed where the root file
 * imports packages, run by Node with no shell, so the build is the one Consumers' compiler reads.
 */
export async function builtWithTsc({ folder, rootPath, spec }: Building): Promise<Built> {
  const tsc = tscOf(rootPath);
  if (tsc.kind === 'failed') {
    return tsc;
  }
  try {
    await execFileAsync(process.execPath, [tsc.path, '-p', folder, '--pretty', 'false'], {
      cwd: folder,
      shell: false,
      timeout: tscTimeoutMilliseconds,
      maxBuffer: maxOutputBytes,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { kind: 'built' };
  } catch (e) {
    return {
      kind: 'failed',
      message: `tsc failed on the Contract Package of ${spec}: ${reasonOf(e)}`,
    };
  }
}

/** The script the project's TypeScript names as its `tsc`, or why there is none. */
function tscOf(
  rootPath: string,
): { readonly kind: 'tsc'; readonly path: string } | Extract<Built, { kind: 'failed' }> {
  const installed = installedManifestOf('typescript', rootPath);
  if (installed.kind === 'failed') {
    const message = `${installed.message}: publish builds the Contract Package with its tsc`;
    return { kind: 'failed', message };
  }
  const bin = installed.manifest['bin'];
  const tsc = typeof bin === 'object' && bin !== null ? Reflect.get(bin, 'tsc') : undefined;
  if (typeof tsc !== 'string') {
    return { kind: 'failed', message: 'typescript has no tsc in its package.json bin' };
  }
  return { kind: 'tsc', path: join(installed.directory, tsc) };
}

/** The first line `tsc` printed, else why the run ended. */
function reasonOf(thrown: unknown): string {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown));
  const { code, stdout, stderr }: Readonly<Record<string, unknown>> = { ...error };
  const printed = [stdout, stderr].map(firstLineOf).find((line) => line !== '');
  if (printed !== undefined) {
    return printed;
  }
  return typeof code === 'number' ? `exit status ${code}` : firstLineOf(error.message);
}

function firstLineOf(text: unknown): string {
  return typeof text === 'string' ? (text.trim().split('\n', 1)[0] ?? '') : '';
}
