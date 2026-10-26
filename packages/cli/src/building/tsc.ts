import { join } from 'node:path';
import { exitReasonOf, type Failed, failed, ranChild } from '../child-process/index.ts';
import { installedManifestOf } from '../loading/index.ts';

/** What `tsc -p` builds: a staged folder, the Root file whose project's TypeScript builds it, and the package it is of. */
export type Building = {
  readonly folder: string;
  readonly rootPath: string;
  readonly spec: string;
};

/** The folder built, or why it was not, in one line. */
export type Built = { readonly kind: 'built' } | Failed;

/**
 * Builds a staged Contract Package with `tsc -p`, the TypeScript installed where the Root file
 * imports packages, run by Node with no shell, so the build is the one Consumers' compiler reads.
 */
export async function builtWithTsc({ folder, rootPath, spec }: Building): Promise<Built> {
  const tsc = tscOf(rootPath);
  if (tsc.kind === 'failed') {
    return tsc;
  }
  const label = `tsc on the Contract Package of ${spec}`;
  const ended = await ranChild({
    label,
    file: process.execPath,
    args: [tsc.path, '-p', folder, '--pretty', 'false'],
    cwd: folder,
  });
  switch (ended.kind) {
    case 'exited':
      return { kind: 'built' };
    case 'errored': {
      const reason = exitReasonOf([ended.stdout, ended.stderr], ended.status);
      return failed(`${label} failed: ${reason}`);
    }
    case 'unrunnable':
      return failed(`${label} cannot be run: ${ended.reason}`);
    case 'failed':
      return ended;
  }
}

/** The script the project's TypeScript names as its `tsc`, or why there is none. */
function tscOf(rootPath: string): { readonly kind: 'tsc'; readonly path: string } | Failed {
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
