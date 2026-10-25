import { isSemanticVersion, ownOf } from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { jsonFromNpm, type NpmPlace } from './npm.ts';
import type { Versions } from './versions.ts';

/** The version the Check compares with, and whether the highest was taken or `--against` named it. */
export type ChosenVersion = {
  readonly kind: 'chosen';
  readonly version: string;
  readonly chosen: 'highest' | 'against';
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
 * The version the Check compares with: the highest listed, or the one `--against` names, itself
 * or the version a dist-tag points at; a name the package lists neither way is a failure.
 */
export async function chosenVersionOf(
  npm: NpmPlace,
  listed: Versions,
  { packageName, against }: AgainstQuery,
): Promise<ChosenVersion | Failed> {
  if (against === undefined) {
    return { kind: 'chosen', version: listed.highest, chosen: 'highest' };
  }
  const named = await namedVersionOf(npm, listed, { packageName, against });
  switch (named.kind) {
    case 'named':
      return { kind: 'chosen', version: named.version, chosen: 'against' };
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
