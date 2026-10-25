import { join } from 'node:path';
import type { PeerRanges } from '@cf-loom/contract/internal';
import { type Peers, peerRangesOf, publishedPeersOf } from '../contract-package/index.ts';
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

/**
 * The peer ranges a package of a kind is published with, which its package.json declares and the
 * version derivation compares with the Baseline's: the two peers for a Contract Package, and for
 * a Definitions Package those its package.json lists too.
 */
export function publishedRangesOf(built: BuiltProject, peers: Peers): PeerRanges {
  switch (built.snapshot.kind) {
    case 'service':
    case 'application':
      return peerRangesOf(peers);
    case 'definitions':
      return publishedPeersOf(built.project.manifest, peers);
  }
}
