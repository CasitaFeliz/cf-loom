import { type Failed, failed } from '../child-process/index.ts';
import { jsonFromNpm, type NpmPlace, type Refused, viewedVersions } from './npm.ts';
import { type Listing, type Versions, versionsFrom } from './versions.ts';

/** npm's 404 for a package, before anything is known of why the registry lacks it: the summary's first line as npm printed it, which names the URL that answered. */
export type NotFound = { readonly kind: 'not-found'; readonly printed: string };

/** What a message calls the `npm view` of a package's versions. */
export function viewLabelOf(packageName: string): string {
  return `npm view ${packageName}`;
}

/** Reads, through the organization's own npm, every version a package lists. */
export async function versionsOf(
  npm: NpmPlace,
  packageName: string,
): Promise<Versions | NotFound | Failed> {
  const call = { label: viewLabelOf(packageName), args: ['view', packageName, 'versions'] };
  const run = await jsonFromNpm(npm, call, viewedVersions);
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
 * Reads a package's versions again right before `publish` puts a version, and fails when the
 * list holds one the listing `publish` first read did not, since the Compatibility Check never
 * judged against it.
 */
export async function unchangedSince(
  npm: NpmPlace,
  { packageName, versions }: Listing,
): Promise<{ readonly kind: 'unchanged' } | Failed> {
  const listed = await versionsOf(npm, packageName);
  switch (listed.kind) {
    case 'failed':
      return listed;
    case 'not-found':
      return { kind: 'unchanged' };
    case 'versions': {
      const meanwhile = listed.listing.versions.filter((version) => !versions.includes(version));
      const highest = meanwhile.at(-1);
      return highest === undefined
        ? { kind: 'unchanged' }
        : failed(publishedMeanwhile(packageName, highest));
    }
  }
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
  return { kind: 'not-found', printed: refused.printed };
}
