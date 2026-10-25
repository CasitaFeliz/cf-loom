import type { Run } from '../project/index.ts';
import { checkedJsonOf, errorsExitOf } from './check-json.ts';
import { linesOf } from './check-lines.ts';
import { type Checked, endingOf } from './checked.ts';
import { checkedFrom, committedBuiltOf, comparisonOf } from './comparison.ts';
import type { Exit, Stopped } from './exit.ts';

/** How a command prints: its lines, or, for `check` and `broker-plan`, one JSON document. */
export type Output = 'lines' | 'json';

/** How `check` was asked to run: how it prints, and the version or dist-tag to compare with instead of the highest version. */
export type CheckOptions = { readonly output: Output; readonly against: string | undefined };

/**
 * Runs the Compatibility Check of the committed Snapshot against its Baseline and prints every
 * Change with its class and Verdict; it only reports, and the organization enforces any Approval.
 */
export async function check(run: Run, { output, against }: CheckOptions): Promise<Exit> {
  const checked = await checkedOf(run, against);
  switch (output) {
    case 'lines':
      return linesExitOf(checked);
    case 'json':
      return jsonExitOf(checked);
  }
}

function linesExitOf(checked: Checked | Stopped): Exit {
  if (checked.kind === 'stopped') {
    return checked.exit;
  }
  const { status, stderr } = endingOf(checked.changes);
  return { status, stdout: linesOf(checked, status), stderr };
}

function jsonExitOf(checked: Checked | Stopped): Exit {
  if (checked.kind === 'stopped') {
    return errorsExitOf(checked.exit);
  }
  const { status, stderr } = endingOf(checked.changes);
  return { status, stdout: [checkedJsonOf(checked, status)], stderr };
}

async function checkedOf(run: Run, against: string | undefined): Promise<Checked | Stopped> {
  const built = await committedBuiltOf(run);
  if (built.kind === 'stopped') {
    return built;
  }
  const comparison = await comparisonOf(built, run, against);
  return comparison.kind === 'stopped' ? comparison : checkedFrom(comparison);
}
