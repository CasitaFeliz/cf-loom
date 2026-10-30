import { readFileSync } from 'node:fs';

/** The part of `changeset status --output` that the check reads: each changeset a PR carries and the bump it gives. */
export type ChangesetStatus = {
  readonly changesets: readonly {
    readonly id: string;
    readonly releases: readonly { readonly type: 'major' | 'minor' | 'patch' | 'none' }[];
  }[];
};

const breakingTitle = /^[a-z]+(\([^)]*\))?!:/;

/**
 * Why a PR's changesets disagree with the `!` of its title, or `undefined` when they agree: a title with
 * `!` needs a major changeset, so that the bump follows the title and not a precedent.
 */
export function bumpProblem(title: string, status: ChangesetStatus): string | undefined {
  const majors = status.changesets
    .filter(({ releases }) => releases.some(({ type }) => type === 'major'))
    .map(({ id }) => id);
  if (breakingTitle.test(title) && majors.length === 0) {
    return 'the title has "!", so a changeset must bump a package major, or the title drops the "!".';
  }
  if (!breakingTitle.test(title) && majors.length > 0) {
    return `a changeset bumps a package major (${majors.join(', ')}), so the title needs "!": \`type!: …\` or \`type(scope)!: …\`.`;
  }
  return undefined;
}

/** The PR title and the file `changeset status --since=origin/main --output` wrote, both given as arguments. */
function checkPullRequest(): void {
  const [title, statusPath] = process.argv.slice(2);
  if (title === undefined || statusPath === undefined) {
    console.error('usage: node scripts/check-changeset-bump.ts <PR title> <changeset status file>');
    process.exitCode = 1;
    return;
  }
  const status: ChangesetStatus = JSON.parse(readFileSync(statusPath, 'utf8'));
  const problem = bumpProblem(title, status);
  if (problem !== undefined) {
    console.error(`changeset bump: ${problem}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  checkPullRequest();
}
