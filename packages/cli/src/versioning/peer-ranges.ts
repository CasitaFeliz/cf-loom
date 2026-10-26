import { type PeerRanges, semanticVersionPartsOf, zodPeerRange } from '@cf-loom/contract/internal';

/**
 * The peer ranges every package a CLI of this version publishes declares: `@cf-loom/contract` from
 * the start of the CLI's minor, or its exact version for a prerelease or a 0.0.x version, so the
 * `@cf-loom/contract` released with it always satisfies the range; and `zod` as
 * `@cf-loom/contract` declares it.
 */
export function peerRangesOf(cliVersion: string): PeerRanges {
  return { '@cf-loom/contract': contractRangeOf(cliVersion), zod: zodPeerRange };
}

function contractRangeOf(cliVersion: string): string {
  const { core, prerelease } = semanticVersionPartsOf(cliVersion);
  const [major, minor, patch] = core;
  if (prerelease.length > 0) {
    return `^${core.join('.')}-${prerelease.join('.')}`;
  }
  return major === '0' && minor === '0' ? `^0.0.${patch}` : `^${major}.${minor}.0`;
}
