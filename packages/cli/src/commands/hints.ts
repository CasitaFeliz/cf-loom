import type { Change, ChangeSite, ShapeDifference } from '@cf-loom/contract/internal';

const makeOptionalHint = 'make it optional';
const openEnumHint = 'declare it with openEnum, so readers take values added later';
const newMessageVersionHint = 'make the change in a new Message Version';

/** What to do about a Change, from a closed table of the moves that fix one; none for a Change the table has no row for. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the hint of each kind of difference
export function hintOf(change: Change): string | null {
  const { site, difference } = change;
  switch (difference.kind) {
    case 'deleted':
      return 'retire it instead, deprecating it first if it is not, and delete it once the Baseline has it Retired';
    case 'retired-before-deprecated':
      return 'deprecate it in one publish and retire it in a later one';
    case 'header-refuses-text':
      return 'accept any text';
    case 'name-kind-changed':
      return 'declare it under a new name';
    case 'identity-reused':
      return isMessage(site) ? newMessageVersionHint : null;
    case 'schema':
      return shapeHintOf(change, difference.shape);
    case 'added':
    case 'deprecated':
    case 'reactivated':
    case 'retired':
    case 'retired-brought-back':
    case 'tombstoned':
    case 'version-gap':
    case 'event-changed':
    case 'export-changed':
    case 'renamed':
    case 'shadowed':
    case 'visibility-widened':
    case 'visibility-narrowed':
    case 'removed':
    case 'status-changed':
    case 'body-added':
    case 'body-removed':
    case 'param-renamed':
    case 'rejection-added':
    case 'rejection-removed':
      return null;
  }
}

/** How a Breaking change to a shape is avoided. */
function shapeHintOf(
  { site, class: changeClass, verdict }: Change,
  shape: ShapeDifference,
): string | null {
  if (changeClass !== 'breaking') {
    return null;
  }
  if (shape.kind === 'field-added' && shape.required) {
    return makeOptionalHint;
  }
  if (shape.kind === 'value-added' && shape.enum === 'closed' && verdict === 'approval-needed') {
    return openEnumHint;
  }
  return isMessage(site) ? newMessageVersionHint : null;
}

function isMessage(site: ChangeSite): boolean {
  return site.kind === 'event' || site.kind === 'command';
}
