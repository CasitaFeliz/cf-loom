import type { Checked, Ending } from './checked.ts';
import { reasonOf } from './checked.ts';
import type { Exit } from './exit.ts';

/** The format of the document of `check --json` and of every `--json` errors document. */
const jsonFormat = 1;

/** The document `check --json` prints when it compared or found no Baseline, on one line. */
export function checkedJsonOf(checked: Checked, status: Ending['status']): string {
  const { packageName, against, changes } = checked;
  return JSON.stringify({
    format: jsonFormat,
    status,
    package: packageName,
    baseline: against.kind === 'baseline' ? against.version : null,
    stable: against.kind === 'baseline' ? (against.stable ?? null) : null,
    reason: against.kind === 'none' ? reasonOf(against.why) : null,
    changes,
  });
}

/** A stop as a `--json` command ends: the document of its lines as errors on stdout, its lines kept on stderr. */
export function errorsExitOf(stop: Exit): Exit {
  const document = JSON.stringify({ format: jsonFormat, status: stop.status, errors: stop.stderr });
  return { ...stop, stdout: [document] };
}
