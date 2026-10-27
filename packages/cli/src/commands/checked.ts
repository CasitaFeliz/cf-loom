import type { Ending } from '../project/index.ts';
import type { ChosenVersion, NoBaseline } from '../registry/index.ts';
import type { CheckedChange } from './checked-change.ts';
import type { Derivation } from './derivation.ts';

/** What `check` compared a Snapshot with: the version it compared with (the Baseline, or the one `--against` named), how it was chosen and the highest stable version, or the reason it has none. */
type Against =
  | {
      readonly kind: 'baseline';
      readonly version: string;
      readonly stable: string | undefined;
      readonly chosen: ChosenVersion['chosen'];
    }
  | { readonly kind: 'none'; readonly why: NoBaseline };

/** What `check` found before any version is derived: the package, what it was compared with and every Change. */
export type Compared = {
  readonly kind: 'checked';
  readonly packageName: string;
  readonly against: Against;
  readonly changes: readonly CheckedChange[];
};

/** What `check` found, ready to print: the comparison and what `publish` would derive from it. */
export type Checked = Compared & { readonly derivation: Derivation };

/** How `check` ends for these Changes: a refused one fails, then a needed Approval, else done. */
export function endingOf(changes: readonly CheckedChange[]): Ending {
  const refused = changes.filter((change) => change.verdict === 'refused');
  if (refused.length > 0) {
    return { status: 1, stderr: [`The check failed: ${refused.length} Change(s) refused`] };
  }
  const needing = changes.filter((change) => change.verdict === 'approval-needed');
  if (needing.length > 0) {
    const need = `${needing.length} Breaking Change(s) need a Breaking Change Approval`;
    return { status: 2, stderr: [`${need}: your review process enforces it`] };
  }
  return { status: 0, stderr: [] };
}

/** Why a package has no Baseline, naming the registry and the npm user when npm does not know it. */
export function reasonOf(why: NoBaseline): string {
  switch (why.kind) {
    case 'unknown-package':
      return `it is not in ${why.registry} for the npm user ${why.username}: never published, or that login cannot read it`;
  }
}
