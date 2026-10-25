import { type Failed, failed } from '../child-process/index.ts';
import { compareSemanticVersions } from '../versioning/index.ts';
import { jsonFromNpm, type NpmPlace, type Refused } from './npm.ts';
import { type Versions, versionsFrom } from './versions.ts';

/** npm's 404 for a package, before anything is known of why the registry lacks it. */
export type NotFound = { readonly kind: 'not-found' };

/** What a package listed when `publish` first read it: its highest version, or none when npm could not find it. */
export type FirstListing = { readonly packageName: string; readonly highest: string | undefined };

/** Reads, through the organization's own npm, every version a package lists. */
export async function versionsOf(
  npm: NpmPlace,
  packageName: string,
): Promise<Versions | NotFound | Failed> {
  const call = { label: `npm view ${packageName}`, args: ['view', packageName, 'versions'] };
  const run = await jsonFromNpm(npm, call);
  switch (run.kind) {
    case 'json':
      return versionsFrom(packageName, run.value);
    case 'refused':
      return refusedViewOf(packageName, run);
    case 'failed':
      return run;
  }
}

/**
 * Reads a package's versions again right before `publish` puts a version, and fails when one
 * higher than the first listing's was published meanwhile, since the Compatibility Check never judged against it.
 */
export async function unchangedSince(
  npm: NpmPlace,
  { packageName, highest }: FirstListing,
): Promise<{ readonly kind: 'unchanged' } | Failed> {
  const listed = await versionsOf(npm, packageName);
  switch (listed.kind) {
    case 'failed':
      return listed;
    case 'not-found':
      return { kind: 'unchanged' };
    case 'versions':
      return isHigher(listed.highest, highest)
        ? failed(publishedMeanwhile(packageName, listed.highest))
        : { kind: 'unchanged' };
  }
}

function isHigher(listed: string, highest: string | undefined): boolean {
  return highest === undefined || compareSemanticVersions(listed, highest) > 0;
}

function publishedMeanwhile(packageName: string, version: string): string {
  return `${packageName} lists ${version}, published while publish ran: rerun publish, which reads the registry again`;
}

function refusedViewOf(packageName: string, refused: Refused): NotFound | Failed {
  if (refused.code !== 'E404') {
    return failed(refused.message);
  }
  if (refused.summary.startsWith('Unpublished on')) {
    const gone = 'its Baseline is gone, so nothing can be checked against it';
    return failed(`${packageName} was unpublished: ${refused.summary}; ${gone}`);
  }
  return { kind: 'not-found' };
}
