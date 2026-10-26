import { originPackagesOf, type PeerRanges } from '@cf-loom/contract/internal';
import type { BuiltProject, Run } from '../project/index.ts';
import { type UsedVersions, unlistedVersionLinesOf } from '../registry/index.ts';
import { type Comparison, committedBuiltOf, comparisonOf } from './comparison.ts';
import { type Stopped, toolingError } from './exit.ts';
import { publishedRangesOf } from './peers.ts';

/**
 * What `check` and `publish` go on with once the Snapshot is compared: the comparison, the peer
 * ranges the package would be published with, and a line for each version of another package the
 * Contract is declared against that the registry does not list.
 */
export type Prepared = {
  readonly kind: 'prepared';
  readonly comparison: Comparison;
  readonly peerRanges: PeerRanges;
  readonly unlisted: readonly string[];
};

/**
 * Builds the project with its committed Snapshot, takes the peer ranges the package would be
 * published with, compares the Snapshot with its Baseline, or with the version `against` names,
 * and reads which versions it is declared against the registry does not list.
 */
export async function preparedOf(
  run: Run,
  against: string | undefined,
): Promise<Prepared | Stopped> {
  const built = await committedBuiltOf(run);
  if (built.kind === 'stopped') {
    return built;
  }
  const peerRanges = publishedRangesOf(built);
  const comparison = await comparisonOf(built, run, against);
  if (comparison.kind === 'stopped') {
    return comparison;
  }
  const npm = { directory: built.project.directory, env: run.env };
  const unlisted = await unlistedVersionLinesOf(npm, usedVersionsOf(built));
  if (unlisted.kind === 'failed') {
    return { kind: 'stopped', exit: toolingError(unlisted.message) };
  }
  return { kind: 'prepared', comparison, peerRanges, unlisted: unlisted.lines };
}

/** The versions of other packages a built project's Contract is declared against: its Dependencies' and its origins'. */
function usedVersionsOf({ validated, snapshot }: BuiltProject): UsedVersions {
  const dependencies = validated.declarations.dependencies.map(({ dependency, from }) => ({
    provider: dependency.provider.name,
    packageName: from.packageName,
    version: from.version,
  }));
  return { dependencies, origins: originPackagesOf(snapshot) };
}
