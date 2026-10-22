import { join } from 'node:path';
import { contractPackageFilesOf, type Peers } from '../contract-package/index.ts';
import { installedVersionOf } from '../loading/index.ts';
import { type BuiltProject, builtOf, type Run } from '../project/index.ts';
import { writeContractPackageTo } from '../writing/index.ts';
import { committedStopOf, done, type Exit, failureExitOf, toolingError } from './exit.ts';

/** Where `package` writes when no `--out` is given, next to `cf-loom.config.ts`. */
export const defaultPackageFolder = 'contract-package';

/** The version a Contract Package `package` writes carries, until `publish` derives one. */
const localVersion = '0.0.0';

/**
 * Writes the Contract Package of a Service or an Application to `out`, generated from the
 * committed Snapshot, which must be what `generate` would write, so the package is a function of
 * the reviewed file; a Definitions Package is its own source and has none.
 */
export async function packageCommand(run: Run, out: string): Promise<Exit> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return failureExitOf(built);
  }
  const { snapshot, text, project } = built;
  if (snapshot.kind === 'definitions') {
    return toolingError(
      'A Definitions Package has no Contract Package: it is published from its own source',
    );
  }
  const stop = committedStopOf(built);
  if (stop !== undefined) {
    return stop;
  }
  const peers = peersOf(built);
  if (peers.kind === 'failed') {
    return toolingError(peers.message);
  }
  const packaging = { scope: project.scope, version: localVersion, peers: peers.peers };
  const files = contractPackageFilesOf({ snapshot, text }, packaging);
  if (files.kind === 'unnamed') {
    return toolingError(files.line);
  }
  const written = writeContractPackageTo(run.cwd, out, files.files);
  switch (written.kind) {
    case 'written':
      return done([`Wrote ${out}`]);
    case 'refused':
    case 'failed':
      return toolingError(written.message);
  }
}

/** The versions of the two peers as the root file imports them, which the package is built with. */
function peersOf(
  built: BuiltProject,
):
  | { readonly kind: 'found'; readonly peers: Peers }
  | { readonly kind: 'failed'; readonly message: string } {
  const rootPath = join(built.project.directory, built.project.rootFile);
  const contract = installedVersionOf('@cf-loom/contract', rootPath);
  const zod = installedVersionOf('zod', rootPath);
  const builtWith = 'a Contract Package is built with it';
  if (contract.kind === 'failed') {
    return { kind: 'failed', message: `${contract.message}: ${builtWith}` };
  }
  if (zod.kind === 'failed') {
    return { kind: 'failed', message: `${zod.message}: ${builtWith}` };
  }
  return { kind: 'found', peers: { contract: contract.version, zod: zod.version } };
}
