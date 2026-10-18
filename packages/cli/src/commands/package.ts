import { join } from 'node:path';
import { contractPackageFilesOf, type Peers } from '../contract-package/index.ts';
import { installedVersionOf } from '../loading/index.ts';
import { builtOf, snapshotFile } from './built.ts';
import { type Exit, type Run, toolingError } from './exit.ts';
import type { BuiltProject } from './generated-files.ts';
import { writeContractPackageTo } from './package-target.ts';

/** Where `package` writes when no `--out` is given, next to `cf-loom.config.ts`. */
export const defaultPackageFolder = 'contract-package';

/**
 * Writes the Contract Package of a Service or an Application to `out`, generated from the
 * declared Snapshot, so it can be built and tried before `publish`; a Definitions Package is its
 * own source and has none.
 */
export async function writeContractPackage(run: Run, out: string): Promise<Exit> {
  const built = await builtOf(run, 'running');
  if (built.kind === 'stopped') {
    return built.exit;
  }
  const { snapshot } = built;
  if (snapshot.kind === 'definitions') {
    return toolingError(
      'A Definitions Package has no Contract Package: it is published from its own source',
    );
  }
  if (built.committed.kind === 'no-json') {
    const reason = built.committed.reason;
    return toolingError(
      `${snapshotFile} is no JSON (${reason}): restore it or delete it, then run cf-loom package`,
    );
  }
  const peers = peersOf(built);
  if (peers.kind === 'failed') {
    return toolingError(peers.message);
  }
  const files = contractPackageFilesOf(snapshot, {
    scope: built.project.scope,
    peers: peers.peers,
  });
  if (files.kind === 'colliding-defs') {
    const [first, second] = files.ids;
    return toolingError(
      `The recursion ids ${first} and ${second} are one name in code: rename one of them`,
    );
  }
  return writeContractPackageTo(run.cwd, out, files.files);
}

/** The versions of the two peers as the root file imports them, which the package is built with. */
function peersOf(
  built: BuiltProject,
):
  | { readonly kind: 'found'; readonly peers: Peers }
  | { readonly kind: 'failed'; readonly message: string } {
  const rootPath = join(built.project.directory, built.project.rootFile);
  const contract = installedVersionOf('@casitafeliz/loom-contract', rootPath);
  const zod = installedVersionOf('zod', rootPath);
  if (contract.kind === 'failed') {
    return { kind: 'failed', message: `${contract.message}: a Contract Package is built with it` };
  }
  if (zod.kind === 'failed') {
    return { kind: 'failed', message: `${zod.message}: a Contract Package is built with it` };
  }
  return { kind: 'found', peers: { contract: contract.version, zod: zod.version } };
}
