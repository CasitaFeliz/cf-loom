import type { ChangeSite } from '@cf-loom/contract/internal';
import type { ChosenVersion, NoBaseline } from '../registry/index.ts';
import { tokenOf } from './author-path.ts';
import type { CheckedChange } from './checked-change.ts';
import type { Derivation } from './derivation.ts';
import type { ExitStatus } from './exit.ts';

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

/** How `check` ends: done, the check failed or a Breaking Change Approval is needed, with what it says on stderr. */
export type Ending = {
  readonly status: Exclude<ExitStatus, 3>;
  readonly stderr: readonly string[];
};

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

/**
 * Where a Change is: its Snapshot key, with an Endpoint's name, `endpoints.GET /orders/{} (getOrder)`
 * or `events.OrderCreated@2`.
 */
export function siteOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'endpoint':
      return `endpoints.${site.identity} (${tokenOf(site.name)})`;
    case 'event':
      return `events.${site.identity}`;
    case 'command':
      return `commands.${site.identity}`;
    case 'code':
      return `codes.${tokenOf(site.code)}`;
    case 'subscription':
      return `subscriptions.${tokenOf(site.name)}`;
    case 'dependency':
      return `dependencies.${tokenOf(site.name)}`;
    case 'export':
      return `exports.${tokenOf(site.name)}`;
    case 'guard':
      return `guards.${tokenOf(site.name)}`;
    case 'group':
      return `groups.${tokenOf(site.name)}`;
    case 'standard-rejection':
      return `standardRejections.${site.name}`;
  }
}

/** Why a package has no Baseline, naming the registry and the npm user when npm does not know it. */
export function reasonOf(why: NoBaseline): string {
  switch (why.kind) {
    case 'unknown-package':
      return `it is not in ${why.registry} for the npm user ${why.username}: never published, or that login cannot read it`;
  }
}
