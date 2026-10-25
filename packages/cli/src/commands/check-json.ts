import type { Change } from '@cf-loom/contract/internal';
import { type Checked, type Ending, partsOf, reasonOf } from './checked.ts';
import type { Exit } from './exit.ts';

/** The document `check --json` prints when it compared or found no Baseline, on one line. */
export function checkedJsonOf(checked: Checked, status: Ending['status']): string {
  const { packageName, against, changes } = checked;
  return JSON.stringify({
    status,
    package: packageName,
    baseline: against.kind === 'baseline' ? against.version : null,
    stable: against.kind === 'baseline' ? (against.stable ?? null) : null,
    reason: against.kind === 'none' ? reasonOf(against.why) : null,
    changes: changes.map(changeJsonOf),
  });
}

/** A stop as a `--json` command ends: the document of its lines as errors on stdout, its lines kept on stderr. */
export function errorsExitOf(stop: Exit): Exit {
  const document = JSON.stringify({ status: stop.status, errors: stop.stderr });
  return { ...stop, stdout: [document] };
}

function changeJsonOf(change: Change) {
  return {
    ...partsOf(change),
    class: change.class,
    approval: change.class === 'breaking' ? change.approval : null,
  };
}
