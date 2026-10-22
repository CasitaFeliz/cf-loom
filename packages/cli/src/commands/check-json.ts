import { type Change, locationOf } from '@cf-loom/contract/internal';
import { type Checked, reasonOf, siteOf, type Verdict } from './check-lines.ts';
import type { Exit } from './exit.ts';

/** The document `check --json` prints when it compared or found no Baseline, on one line. */
export function checkedJsonOf(checked: Checked, status: Verdict['status']): string {
  const { packageName, against, changes } = checked;
  return JSON.stringify({
    status,
    package: packageName,
    baseline: against.kind === 'baseline' ? against.version : null,
    reason: against.kind === 'none' ? reasonOf(against.why) : null,
    changes: changes.map(changeJsonOf),
  });
}

/** The document `check --json` prints when it stopped: the lines it prints on stderr, as errors. */
export function errorsJsonOf(stop: Exit): string {
  return JSON.stringify({ status: stop.status, errors: stop.stderr });
}

function changeJsonOf(change: Change) {
  const { difference } = change;
  return {
    site: siteOf(change.site),
    difference: difference.kind,
    shape: difference.kind === 'schema' ? difference.shape.kind : null,
    at: 'at' in difference ? locationOf(difference.at) : null,
    position: 'position' in difference ? difference.position : null,
    class: change.class,
    approval: change.class === 'breaking' ? change.approval : null,
  };
}
