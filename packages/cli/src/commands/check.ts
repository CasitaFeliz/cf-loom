import type { Run } from '../project/index.ts';
import { comparedLinesOf, linesOf, notAboveOf } from './check-lines.ts';
import { type Checked, endingOf } from './checked.ts';
import { checkedDocumentOf } from './checked-document.ts';
import { derivedCheckedOf } from './derivation.ts';
import type { Exit } from './exit.ts';
import { preparedOf } from './prepared.ts';

/** How `check` was asked to run: the version or dist-tag to compare with instead of the highest version, and whether to derive a prerelease. */
export type CheckOptions = { readonly against: string | undefined; readonly prerelease: boolean };

/**
 * Runs the Compatibility Check of the committed Snapshot against its Baseline and prints every
 * Change with its class and Verdict, and the version `publish` would take; it only reports, and the
 * organization enforces any Approval.
 */
export async function check(run: Run, { against, prerelease }: CheckOptions): Promise<Exit> {
  const prepared = await preparedOf(run, against);
  if (prepared.kind === 'stopped') {
    return prepared.exit;
  }
  return exitOf(derivedCheckedOf(prepared, { force: false, prerelease }));
}

/** How `check` ends: a version that would not be above the Baseline is a tooling error, as it is for `publish`; else the Changes decide. */
function exitOf(checked: Checked): Exit {
  const derived = checked.derivation?.derived;
  if (derived?.kind === 'not-above') {
    const stderr = [notAboveOf(checked.packageName, derived)];
    return { status: 3, stdout: comparedLinesOf(checked), stderr };
  }
  const { status, stderr } = endingOf(checked.changes);
  return { status, stdout: linesOf(checked, status), stderr, document: checkedDocumentOf(checked) };
}
