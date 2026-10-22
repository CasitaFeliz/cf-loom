import { join } from 'node:path';
import type { Peers } from '../contract-package/index.ts';
import { installedVersionOf } from '../loading/index.ts';
import type { BuiltProject } from '../project/index.ts';

/** The versions of the two peers as the root file imports them, which the package's peer ranges are taken from. */
export function builtPeersOf(
  built: BuiltProject,
):
  | { readonly kind: 'found'; readonly peers: Peers }
  | { readonly kind: 'failed'; readonly message: string } {
  const rootPath = join(built.project.directory, built.project.rootFile);
  const contract = installedVersionOf('@cf-loom/contract', rootPath);
  const zod = installedVersionOf('zod', rootPath);
  const takenFrom = `the package's peer range is taken from it`;
  if (contract.kind === 'failed') {
    return { kind: 'failed', message: `${contract.message}: ${takenFrom}` };
  }
  if (zod.kind === 'failed') {
    return { kind: 'failed', message: `${zod.message}: ${takenFrom}` };
  }
  return { kind: 'found', peers: { contract: contract.version, zod: zod.version } };
}
