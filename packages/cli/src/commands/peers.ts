import type { PeerRanges } from '@cf-loom/contract/internal';
import { publishedPeersOf } from '../contract-package/index.ts';
import { type BuiltProject, runningCliOf } from '../project/index.ts';
import { peerRangesOf } from '../versioning/index.ts';

/**
 * The peer ranges a package of a kind is published with, which its package.json declares and the
 * version derivation compares with the Baseline's: the running CLI's for a Service, none for an
 * Application, which has no code, and for a Definitions Package those its package.json lists too.
 */
export function publishedRangesOf(built: BuiltProject): PeerRanges {
  const ranges = peerRangesOf(runningCliOf().version);
  switch (built.snapshot.kind) {
    case 'service':
      return ranges;
    case 'application':
      return {};
    case 'definitions':
      return publishedPeersOf(built.project.manifest, ranges);
  }
}
