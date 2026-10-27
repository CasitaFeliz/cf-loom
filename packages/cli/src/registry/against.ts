import { isSemanticVersion, ownOf } from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { baselineCandidatesOf } from '../versioning/index.ts';
import { jsonFromNpm, type NpmPlace } from './npm.ts';
import type { Versions } from './versions.ts';

/**
 * The versions the Check reads metadata of, in the order it tries them: the Baseline among the
 * listed versions, or the one `--against` names.
 */
export type Candidates = {
  readonly kind: 'candidates';
  readonly versions: readonly string[];
  readonly chosen: 'baseline' | 'against';
};

/** The package and what `check --against` was given for it, if anything. */
export type AgainstQuery = { readonly packageName: string; readonly against: string | undefined };

/** What `--against` names among a package's listed versions. */
type Named =
  | { readonly kind: 'named'; readonly version: string }
  | { readonly kind: 'unlisted' }
  | Failed;

/**
 * The failure of an `--against` that names no version or dist-tag of the package, which a
 * package npm cannot find lists none of.
 */
export function unlistedAgainstOf(packageName: string, against: string): Failed {
  return failed(
    `${packageName} lists no version or dist-tag ${against}: --against takes one of them`,
  );
}

/**
 * The versions the Check tries: those the Baseline is chosen among, or the one `--against`
 * names, itself or the version a dist-tag points at; a name the package lists neither way is a
 * failure.
 */
export async function candidatesOf(
  npm: NpmPlace,
  listed: Versions,
  { packageName, against }: AgainstQuery,
): Promise<Candidates | Failed> {
  if (against === undefined) {
    const versions = baselineCandidatesOf(listed.versions);
    return { kind: 'candidates', versions, chosen: 'baseline' };
  }
  const named = await namedVersionOf(npm, listed, { packageName, against });
  switch (named.kind) {
    case 'named':
      return { kind: 'candidates', versions: [named.version], chosen: 'against' };
    case 'unlisted':
      return unlistedAgainstOf(packageName, against);
    case 'failed':
      return named;
  }
}

async function namedVersionOf(
  npm: NpmPlace,
  { versions }: Versions,
  { packageName, against }: { readonly packageName: string; readonly against: string },
): Promise<Named> {
  if (versions.includes(against)) {
    return { kind: 'named', version: against };
  }
  if (isSemanticVersion(against)) {
    return { kind: 'unlisted' };
  }
  const label = `npm view ${packageName} dist-tags`;
  const run = await jsonFromNpm(npm, { label, args: ['view', packageName, 'dist-tags'] });
  switch (run.kind) {
    case 'json':
      return namedByTag(versions, ownOf(run.value, against));
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}

function namedByTag(versions: readonly string[], tagged: unknown): Named {
  const isListed = typeof tagged === 'string' && versions.includes(tagged);
  return isListed ? { kind: 'named', version: tagged } : { kind: 'unlisted' };
}
