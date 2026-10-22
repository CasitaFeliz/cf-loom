import { join } from 'node:path';
import type { Peers } from '../contract-package/index.ts';
import { installedVersionOf } from '../loading/index.ts';
import type { BuiltProject } from '../project/index.ts';

/** The versions of the two peers as the root file imports them, which the package is built with. */
export function builtPeersOf(
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
