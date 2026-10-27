import { closingLinesOf, comparedLinesOf, notAboveOf } from './check-lines.ts';
import { type Checked, endingOf } from './checked.ts';
import { checkedDocumentOf } from './checked-document.ts';
import { derivedCheckedOf } from './derivation.ts';
import { done, type Exit, toolingError } from './exit.ts';
import { preparedOf } from './prepared.ts';
import type { Ending, Run } from './run.ts';

/** How `check` was asked to run: the version or dist-tag to compare with instead of the highest version, and whether to derive a prerelease. */
export type CheckOptions = { readonly against: string | undefined; readonly prerelease: boolean };

/**
 * Runs the Compatibility Check of the committed Snapshot against its Baseline and prints every
 * Change with its class and Verdict, and the version `publish` would take, and on stderr each
 * version it is declared against that the registry does not list, which `publish` refuses; it only
 * reports, and the organization enforces any Approval.
 */
export async function check(run: Run, { against, prerelease }: CheckOptions): Promise<Exit> {
  const prepared = await preparedOf(run, against);
  if (prepared.kind === 'stopped') {
    return prepared.exit;
  }
  const checked = derivedCheckedOf(prepared, { force: false, prerelease });
  const ending = endingOf(checked.changes);
  run.report({ lines: comparedLinesOf(checked), fields: checkedDocumentOf(checked), ending });
  run.report({ ending: { status: 0, stderr: prepared.unlisted } });
  return closedExitOf(checked, ending);
}

/** How `check` closes: a version that would not be above the Baseline is a tooling error, as it is for `publish`; else it says what `publish` would take. */
function closedExitOf(checked: Checked, { status }: Ending): Exit {
  const { derivation } = checked;
  if (derivation.kind === 'derived' && derivation.derived.kind === 'not-above') {
    return toolingError(notAboveOf(checked.packageName, derivation.derived));
  }
  return done(closingLinesOf(checked, status), {});
}
