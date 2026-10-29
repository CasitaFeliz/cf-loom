/**
 * Merges a done PR once its CI passed on its head, as WORKFLOW.md's Merge says:
 * `node scripts/merge-when-green.ts <pr> <head sha> [--fixes-main]`. It waits for the `check` job on the head to finish
 * and for GitHub to judge the PR mergeable, refuses while the last CI run on `main` failed (unless the PR is the one
 * that fixes it, `--fixes-main`), then squash-merges with the PR title and `(#<pr>)` as the subject, only if the head is
 * still `<head sha>`. Exit 0 merged, 1 refused, 2 timed out or `gh` failed; a run that exits 2 is run again.
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

/** The check run a PR's CI reports, and the one `main`'s, which runs it through the release workflow. */
const prCheckName = 'check';
const mainCheckName = 'checks / check';

function checkOf(sha: string, name: string): MergeState['check'] {
  const runs = gh([
    'api',
    `repos/${repository}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}`,
    '-q',
    '[.check_runs[] | .status + ":" + (.conclusion // "")] | join(",")',
  ]);
  if (runs === '' || runs.includes('queued') || runs.includes('in_progress')) {
    return 'pending';
  }
  return runs.split(',').every((run) => run === 'completed:success') ? 'success' : 'failure';
}

function stateOf(pr: string, sha: string, fixesMain: boolean): MergeState {
  const mainSha = gh(['api', `repos/${repository}/commits/main`, '-q', '.sha']);
  return {
    check: checkOf(sha, prCheckName),
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
    mainCheck: fixesMain ? 'success' : checkOf(mainSha, mainCheckName),
  };
}

function merge(pr: string, sha: string, fixesMain: boolean): Promise<number> {
  return (async () => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const step = stepOf(stateOf(pr, sha, fixesMain));
      if (step.kind === 'refuse') {
        process.stderr.write(`#${pr} not merged: ${step.reason}\n`);
        return 1;
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
        return 0;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
    }
    process.stderr.write(
      `#${pr} not merged: timed out waiting for CI or mergeability; run it again\n`,
    );
    return 2;
  })();
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
