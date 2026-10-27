import { isSemanticVersion, ownOf } from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { baselineCandidatesOf } from '../versioning/index.ts';
import { jsonFromNpm, type NpmPlace } from './npm.ts';
import type { Listing } from './versions.ts';

/**
 * What the Check reads metadata of: the versions the Baseline is chosen among, in the order they
 * are tried, or the one version `--against` names.
 */
export type Choice =
  | { readonly kind: 'baseline'; readonly candidates: readonly string[] }
  | { readonly kind: 'against'; readonly version: string };

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
 * What the Check reads: the versions the Baseline is chosen among, or the one `--against` names,
 * itself or the version a dist-tag points at; a name the package lists neither way is a failure.
 */
export async function choiceOf(
  npm: NpmPlace,
  listing: Listing,
  against: string | undefined,
): Promise<Choice | Failed> {
  if (against === undefined) {
    return { kind: 'baseline', candidates: baselineCandidatesOf(listing.versions) };
  }
  const { packageName } = listing;
  const named = await namedVersionOf(npm, listing, against);
  switch (named.kind) {
    case 'named':
      return { kind: 'against', version: named.version };
    case 'unlisted':
      return unlistedAgainstOf(packageName, against);
    case 'failed':
      return named;
  }
}

async function namedVersionOf(
  npm: NpmPlace,
  { packageName, versions }: Listing,
  against: string,
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
