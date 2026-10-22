import type { Change } from '@cf-loom/contract/internal';
import { type Checked, type Ending, partsOf, reasonOf, tokenOf } from './checked.ts';

/** Fields whose value is a JSON value, written as JSON so `1` and `"1"` differ. */
const jsonFields = new Set(['value']);

/** Fields a Change line has a word for, so it does not repeat them as `name=value`. */
const wordedFields = new Set(['kind', 'at', 'position', 'shape']);

/** A Change on one line: its site, its kinds and fields, and its class. */
export function changeLineOf(change: Change): string {
  const parts = partsOf(change);
  const kinds = parts.shape === null ? [parts.difference] : [parts.difference, parts.shape];
  const path = parts.at === null ? [] : [`at ${parts.at}`];
  const where = parts.position === null ? [] : [`(${parts.position})`];
  const described = [...kinds, ...path, ...where, ...fieldsOf(change)].join(' ');
  return `${parts.site} ${described}: ${classTextOf(change)}`;
}

/** The fields of a difference and its shape that the line has no word for, as `name=value`. */
function fieldsOf({ difference }: Change): string[] {
  const shape = difference.kind === 'schema' ? difference.shape : {};
  const named = [...Object.entries(difference), ...Object.entries(shape)];
  const unworded = named.filter(([name]) => !wordedFields.has(name));
  return unworded.map(([name, value]) => `${name}=${valueTextOf(name, value)}`);
}

function valueTextOf(name: string, value: unknown): string {
  if (jsonFields.has(name)) {
    return JSON.stringify(value);
  }
  return typeof value === 'string' ? tokenOf(value) : String(value);
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

/** The lines a command opens with: the Baseline it compared with and every Change, or why there is no Baseline. */
export function comparedLinesOf({ packageName, against, changes }: Checked): readonly string[] {
  if (against.kind === 'none') {
    return [`${packageName} has no Baseline: ${reasonOf(against.why)}`];
  }
  return [`Checked against ${packageName}@${against.version}`, ...changes.map(changeLineOf)];
}

/** The lines `check` prints on stdout: the Baseline it used, every Change, and how it closes. */
export function linesOf(checked: Checked, status: Ending['status']): readonly string[] {
  const { packageName, against, changes } = checked;
  const compared = comparedLinesOf(checked);
  if (against.kind === 'none') {
    return compared;
  }
  return [...compared, ...closingLinesOf(`${packageName}@${against.version}`, changes, status)];
}

function closingLinesOf(
  compared: string,
  changes: readonly Change[],
  status: Ending['status'],
): string[] {
  if (changes.length === 0) {
    return [`No Change against ${compared}`];
  }
  return status === 0 ? ['No Change needs a Breaking Change Approval'] : [];
}
