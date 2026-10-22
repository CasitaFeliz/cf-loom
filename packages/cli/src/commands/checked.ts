import { type Change, type ChangeSite, locationOf, type Path } from '@cf-loom/contract/internal';
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
export type Ending = {
  readonly status: Exclude<ExitStatus, 3>;
  readonly stderr: readonly string[];
};

/** What a Change says apart from its class: its site, its kinds, and the path and Position of a Difference that has them. */
export type ChangeParts = {
  readonly site: string;
  readonly difference: string;
  readonly shape: string | null;
  readonly at: string | null;
  readonly position: string | null;
};

/** What a path segment or a text may be on a Change line without quotes. */
const plainToken = /^[\w@/{}$-]+$/;

/** The characters besides the ones JSON escapes that some readers end a line at: NEL, LS and PS. */
const lineEndings = /[\u0085\u2028\u2029]/g;

/** How `check` ends for these Changes: Not allowed fails, then a needed Approval, else done. */
export function endingOf(changes: readonly Change[]): Ending {
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
      return `codes.${tokenOf(site.code)}`;
    case 'subscription':
      return `subscriptions.${tokenOf(site.name)}`;
    case 'shared-schema':
      return `schemas.${tokenOf(site.name)}`;
    case 'guard':
      return `guards.${tokenOf(site.name)}`;
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

/** The one place a line and the JSON document read where and how a Change differs. */
export function partsOf(change: Change): ChangeParts {
  const { difference } = change;
  return {
    site: siteOf(change.site),
    difference: difference.kind,
    shape: difference.kind === 'schema' ? difference.shape.kind : null,
    at: 'at' in difference ? locationTextOf(difference.at) : null,
    position: 'position' in difference ? difference.position : null,
  };
}

/** A text as it stands on a Change line: itself when plain, else as JSON, so it never splits the line. */
export function tokenOf(text: string): string {
  return plainToken.test(text) ? text : jsonTextOf(text);
}

/** A value as JSON that no reader splits into lines: the line endings JSON leaves as they are, written as escapes. */
export function jsonTextOf(value: unknown): string {
  const escaped = (character: string) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  return JSON.stringify(value).replace(lineEndings, escaped);
}

function locationTextOf(at: Path): string {
  return locationOf(at.map((segment) => tokenOf(String(segment))));
}
