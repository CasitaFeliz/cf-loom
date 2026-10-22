import { type Change, type ChangeSite, locationOf } from '@cf-loom/contract/internal';
import type { NoBaseline } from '../registry/index.ts';
import type { ExitStatus } from './exit.ts';

/** What `check` compared a Snapshot with: its Baseline's version, or the reason it has none. */
type Against =
  | { readonly kind: 'baseline'; readonly version: string }
  | { readonly kind: 'none'; readonly why: NoBaseline };

/** What `check` found, ready to print: the package, what it was compared with and every Change. */
export type Checked = {
  readonly kind: 'checked';
  readonly packageName: string;
  readonly against: Against;
  readonly changes: readonly Change[];
};

/** How `check` ends: done, the check failed or a Breaking Change Approval is needed, with what it says on stderr. */
export type Verdict = {
  readonly status: Exclude<ExitStatus, 3>;
  readonly stderr: readonly string[];
};

/** Fields whose value is a JSON value, written as JSON so `1` and `"1"` differ. */
const jsonFields = new Set(['value']);

/** Fields a Change line has a word for, so it does not repeat them as `name=value`. */
const wordedFields = new Set(['kind', 'at', 'position', 'shape']);

/** Where a Change is, as a Snapshot keys it: `endpoints.GET /orders/{}`, `events.OrderCreated@2`. */
export function siteOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'endpoint':
      return `endpoints.${site.identity}`;
    case 'event':
      return `events.${site.identity}`;
    case 'command':
      return `commands.${site.identity}`;
    case 'code':
      return `codes.${site.code}`;
    case 'subscription':
      return `subscriptions.${site.name}`;
    case 'shared-schema':
      return `schemas.${site.name}`;
    case 'guard':
      return `guards.${site.name}`;
  }
}

/** Why a package has no Baseline, naming the registry and the npm user when npm does not know it. */
export function reasonOf(why: NoBaseline): string {
  switch (why.kind) {
    case 'unknown-package':
      return `it is not in ${why.registry} for the npm user ${why.username}: never published, or that login cannot read it`;
    case 'only-prereleases':
      return `it has only prereleases, the highest ${why.versions.at(-1)}`;
  }
}

/** A Change on one line: its site, its kinds and fields, and its class. */
export function changeLineOf(change: Change): string {
  const { difference } = change;
  const kinds =
    difference.kind === 'schema' ? [difference.kind, difference.shape.kind] : [difference.kind];
  const path = 'at' in difference ? [`at ${locationOf(difference.at)}`] : [];
  const position = 'position' in difference ? [`(${difference.position})`] : [];
  const shape = difference.kind === 'schema' ? difference.shape : {};
  const fields = [...fieldsOf(difference), ...fieldsOf(shape)];
  const described = [...kinds, ...path, ...position, ...fields].join(' ');
  return `${siteOf(change.site)} ${described}: ${classTextOf(change)}`;
}

/** The fields of a difference or a shape that the line has no word for, as `name=value`. */
function fieldsOf(difference: object): string[] {
  const named = Object.entries(difference).filter(([name]) => !wordedFields.has(name));
  return named.map(([name, value]) => `${name}=${valueTextOf(name, value)}`);
}

function valueTextOf(name: string, value: unknown): string {
  return jsonFields.has(name) ? JSON.stringify(value) : String(value);
}

/** A Change's class in words. */
function classTextOf(change: Change): string {
  switch (change.class) {
    case 'additive':
      return 'Additive';
    case 'neutral':
      return 'Neutral';
    case 'not-allowed':
      return 'Not allowed';
    case 'breaking':
      return change.approval === 'needed'
        ? 'Breaking, needs a Breaking Change Approval'
        : 'Breaking, needs no Approval';
  }
}

/** How `check` ends for these Changes: Not allowed fails, then a needed Approval, else done. */
export function verdictOf(changes: readonly Change[]): Verdict {
  const notAllowed = changes.filter((change) => change.class === 'not-allowed');
  if (notAllowed.length > 0) {
    return { status: 1, stderr: [`The check failed: ${notAllowed.length} Change(s) not allowed`] };
  }
  const needing = changes.filter(
    (change) => change.class === 'breaking' && change.approval === 'needed',
  );
  if (needing.length > 0) {
    const need = `${needing.length} Breaking Change(s) need a Breaking Change Approval`;
    return { status: 2, stderr: [`${need}: your review process enforces it`] };
  }
  return { status: 0, stderr: [] };
}

/** The lines `check` prints on stdout: the Baseline it used, every Change, and how it closes. */
export function linesOf(checked: Checked, status: Verdict['status']): readonly string[] {
  const { packageName, against, changes } = checked;
  if (against.kind === 'none') {
    return [`${packageName} has no Baseline: ${reasonOf(against.why)}`];
  }
  const compared = `${packageName}@${against.version}`;
  const closing = closingLinesOf(compared, { changes, status });
  return [`Checked against ${compared}`, ...changes.map(changeLineOf), ...closing];
}

function closingLinesOf(
  compared: string,
  { changes, status }: { changes: readonly Change[]; status: Verdict['status'] },
): string[] {
  if (changes.length === 0) {
    return [`No Change against ${compared}`];
  }
  return status === 0 ? ['No Change needs a Breaking Change Approval'] : [];
}
