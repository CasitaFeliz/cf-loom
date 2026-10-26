import { type PeerRanges, semanticVersionPartsOf, zodPeerRange } from '@cf-loom/contract/internal';
import { isPrerelease } from './semantic-versions.ts';

/**
 * The peer ranges every package a CLI of this version publishes declares: `@cf-loom/contract` from
 * the start of the CLI's minor, or a caret on its exact version for a prerelease or a 0.0.x
 * version, so the `@cf-loom/contract` released with it always satisfies the range; and `zod` as
 * `@cf-loom/contract` declares it.
 */
export function peerRangesOf(cliVersion: string): PeerRanges {
  return { '@cf-loom/contract': contractRangeOf(cliVersion), zod: zodPeerRange };
}

function contractRangeOf(cliVersion: string): string {
  if (isPrerelease(cliVersion)) {
    return `^${cliVersion}`;
  }
  const [major, minor, patch] = semanticVersionPartsOf(cliVersion).core;
  return major === '0' && minor === '0' ? `^0.0.${patch}` : `^${major}.${minor}.0`;
}
