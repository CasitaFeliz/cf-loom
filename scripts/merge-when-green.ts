/**
 * Merges a done PR once its CI passed on its head, as WORKFLOW.md's Merge says:
 * `node scripts/merge-when-green.ts <pr> <head sha>`. It waits for the `check` job on the head to finish and for
 * GitHub to judge the PR mergeable, refuses while the last CI run on `main` failed, then squash-merges with the PR
 * title and `(#<pr>)` as the subject, only if the head is still `<head sha>`. Exit 0 merged, 1 refused, 2 timed out.
 */
import { execFileSync } from 'node:child_process';

/** What the script sees of the PR, its head's `check` job and `main`'s last CI run. */
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

function checkOf(sha: string): MergeState['check'] {
  const runs = gh([
    'api',
    `repos/${repository}/commits/${sha}/check-runs?check_name=check`,
    '-q',
    '[.check_runs[] | .status + ":" + (.conclusion // "")] | join(",")',
  ]);
  if (runs === '' || runs.includes('queued') || runs.includes('in_progress')) {
    return 'pending';
  }
  return runs.split(',').every((run) => run === 'completed:success') ? 'success' : 'failure';
}

function stateOf(pr: string, sha: string): MergeState {
  const mainSha = gh(['api', `repos/${repository}/commits/main`, '-q', '.sha']);
  return {
    check: checkOf(sha),
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
    mainCheck: checkOf(mainSha),
  };
}

if (import.meta.main) {
  const [pr, sha] = process.argv.slice(2);
  if (pr === undefined || sha === undefined) {
    process.stderr.write('usage: node scripts/merge-when-green.ts <pr> <head sha>\n');
    process.exit(1);
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const step = stepOf(stateOf(pr, sha));
    if (step.kind === 'refuse') {
      process.stderr.write(`#${pr} not merged: ${step.reason}\n`);
      process.exit(1);
    }
    if (step.kind === 'merge') {
      const title = gh(['pr', 'view', pr, '-R', repository, '--json', 'title', '-q', '.title']);
      gh([
        'pr',
        'merge',
        pr,
        '-R',
        repository,
        '--squash',
        '--delete-branch',
        '--subject',
        `${title} (#${pr})`,
        '--match-head-commit',
        sha,
      ]);
      process.stdout.write(`#${pr} merged\n`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
  process.stderr.write(
    `#${pr} not merged: timed out waiting for CI or mergeability; run it again\n`,
  );
  process.exit(2);
}
