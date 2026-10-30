/**
 * Merges a done PR once its CI passed on its head, as WORKFLOW.md's Merge says:
 * `node scripts/merge-when-green.ts <pr> <head sha> [--fixes-main]`. It waits for every job of CI on the head to finish
 * and for GitHub to judge the PR mergeable, refuses while the last CI run on `main` failed (unless the PR is the one
 * that fixes it, `--fixes-main`), then squash-merges with the PR title and `(#<pr>)` as the subject, only if the head is
 * still `<head sha>`; GitHub deletes the merged branch. A PR already merged counts as merged, so a run that exits 2 is
 * run again safely. Exit 0 merged, 1 refused, 2 timed out or `gh` failed.
 */
import { execFileSync } from 'node:child_process';

/** What the script sees of the PR, the jobs of CI on its head and `main`'s last CI run. */
export type MergeState = {
  readonly check: 'pending' | 'success' | 'failure';
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  readonly mainCheck: 'pending' | 'success' | 'failure';
};

/** What to do in a state: wait and look again, merge, or refuse with the reason. */
export type MergeStep =
  | { readonly kind: 'wait' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'refuse'; readonly reason: string };

/** A check run of GitHub Actions as GitHub reports it: its name, its status, and its conclusion once it completed. */
export type CheckRun = {
  readonly name: string;
  readonly status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  readonly conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'skipped'
    | 'timed_out'
    | 'action_required'
    | 'stale'
    | null;
};

/**
 * What the check runs whose name starts with `prefix` say of CI: a run that completed with
 * anything but success fails it, even while others still run; no run yet, or one not completed,
 * leaves it pending; and it passed when every run completed with success.
 */
export function ciOf(runs: readonly CheckRun[], prefix = ''): MergeState['check'] {
  const counted = runs.filter(({ name }) => name.startsWith(prefix));
  if (counted.some((run) => run.status === 'completed' && run.conclusion !== 'success')) {
    return 'failure';
  }
  const isSettling = counted.length === 0 || counted.some((run) => run.status !== 'completed');
  return isSettling ? 'pending' : 'success';
}

/** The step for a state: a failure refuses at once, anything still settling waits, and only all green merges. */
export function stepOf(state: MergeState): MergeStep {
  if (state.check === 'failure') {
    return { kind: 'refuse', reason: 'CI failed on the head' };
  }
  if (state.mergeable === 'CONFLICTING') {
    return { kind: 'refuse', reason: 'the PR conflicts with main; merge main into it first' };
  }
  if (state.mainCheck === 'failure') {
    return {
      kind: 'refuse',
      reason: 'the last CI run on main failed; fix main before the next merge',
    };
  }
  if (state.check === 'pending' || state.mergeable === 'UNKNOWN' || state.mainCheck === 'pending') {
    return { kind: 'wait' };
  }
  return { kind: 'merge' };
}

const repository = 'CasitaFeliz/cf-loom';
const pollMilliseconds = 30_000;
const attempts = 60;

function gh(args: readonly string[]): string {
  return execFileSync('gh', [...args], { encoding: 'utf8' }).trim();
}

/** The prefix of the check runs of CI on `main`, which the release workflow calls `checks`; its other jobs are not CI. */
const mainRunPrefix = 'checks / ';

function checkRunsAt(sha: string): readonly CheckRun[] {
  const printed = gh([
    'api',
    `repos/${repository}/commits/${sha}/check-runs?per_page=100`,
    '--paginate',
    '-q',
    '.check_runs[] | select(.app.slug == "github-actions") | {name, status, conclusion} | @json',
  ]);
  return printed === '' ? [] : printed.split('\n').map((line) => JSON.parse(line));
}

function stateOf(pr: string, sha: string, fixesMain: boolean): MergeState {
  const mainSha = gh(['api', `repos/${repository}/commits/main`, '-q', '.sha']);
  return {
    check: ciOf(checkRunsAt(sha)),
    mergeable: gh([
      'pr',
      'view',
      pr,
      '-R',
      repository,
      '--json',
      'mergeable',
      '-q',
      '.mergeable',
    ]) as MergeState['mergeable'],
    mainCheck: fixesMain ? 'success' : ciOf(checkRunsAt(mainSha), mainRunPrefix),
  };
}

function prField(pr: string, field: string): string {
  return gh(['pr', 'view', pr, '-R', repository, '--json', field, '-q', `.${field}`]);
}

/** Squash-merges the PR's head `sha` with the PR title and `(#<pr>)` as the subject. */
function squashMerge(pr: string, sha: string): void {
  const subject = `${prField(pr, 'title')} (#${pr})`;
  gh([
    'pr',
    'merge',
    pr,
    '-R',
    repository,
    '--squash',
    '--subject',
    subject,
    '--match-head-commit',
    sha,
  ]);
}

async function merge(pr: string, sha: string, fixesMain: boolean): Promise<number> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (prField(pr, 'state') === 'MERGED') {
      process.stdout.write(`#${pr} merged\n`);
      return 0;
    }
    const step = stepOf(stateOf(pr, sha, fixesMain));
    if (step.kind === 'refuse') {
      process.stderr.write(`#${pr} not merged: ${step.reason}\n`);
      return 1;
    }
    if (step.kind === 'merge') {
      squashMerge(pr, sha);
      process.stdout.write(`#${pr} merged\n`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
  process.stderr.write(
    `#${pr} not merged: timed out waiting for CI or mergeability; run it again\n`,
  );
  return 2;
}

if (import.meta.main) {
  const [pr, sha, flag] = process.argv.slice(2);
  if (pr === undefined || sha === undefined || (flag !== undefined && flag !== '--fixes-main')) {
    process.stderr.write(
      'usage: node scripts/merge-when-green.ts <pr> <head sha> [--fixes-main]\n',
    );
    process.exit(1);
  }
  try {
    process.exit(await merge(pr, sha, flag === '--fixes-main'));
  } catch (error) {
    process.stderr.write(`#${pr} not merged: gh failed (${String(error)}); run it again\n`);
    process.exit(2);
  }
}
