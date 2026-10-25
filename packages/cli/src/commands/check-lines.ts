import { firstStableOf } from '../versioning/index.ts';
import { tokenOf } from './author-path.ts';
import { type Checked, type Ending, reasonOf, siteOf } from './checked.ts';
import type { CheckedChange, DifferenceJson } from './checked-change.ts';

/** Fields whose value is a JSON value, written as JSON so `1` and `"1"` differ. */
const jsonFields = new Set(['value']);

/** Fields a Change line has a word for, so it does not repeat them as `name=value`. */
const wordedFields = new Set(['kind', 'at', 'position', 'shape']);

/** A Change on one line: its site, its kinds, path, Position and fields, its class and Verdict, and its hint. */
export function changeLineOf(change: CheckedChange): string {
  const { site, difference, path } = change;
  const shape = difference.kind === 'schema' ? [difference.shape.kind] : [];
  const where = path === null ? [] : [`at ${path}`];
  const described = [
    difference.kind,
    ...shape,
    ...where,
    ...positionOf(difference),
    ...fieldsOf(difference),
  ].join(' ');
  const hint = change.hint === null ? '' : `; ${change.hint}`;
  return `${siteOf(site)} ${described}: ${judgmentOf(change)}${hint}`;
}

/** The Position, written only when the path does not already start with it. */
function positionOf(difference: DifferenceJson): string[] {
  if (!('position' in difference)) {
    return [];
  }
  const startsWithIt = 'at' in difference && difference.at[0] === difference.position;
  return startsWithIt ? [] : [`(${difference.position})`];
}

/** The fields of a difference and its shape that the line has no word for, as `name=value`. */
function fieldsOf(difference: DifferenceJson): string[] {
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

/** A Change's class in words, then what the Verdict adds to it. */
function judgmentOf({ class: changeClass, verdict }: CheckedChange): string {
  const word = classWordOf(changeClass);
  switch (verdict) {
    case 'allowed':
      return changeClass === 'breaking' ? `${word}, needs no Approval` : word;
    case 'approval-needed':
      return `${word}, needs a Breaking Change Approval`;
    case 'refused':
      return `${word}, refused`;
  }
}

function classWordOf(changeClass: CheckedChange['class']): string {
  switch (changeClass) {
    case 'breaking':
      return 'Breaking';
    case 'additive':
      return 'Additive';
    case 'neutral':
      return 'Neutral';
  }
}

/** The lines a command opens with: the Baseline it compared with, or why there is none, then every Change. */
export function comparedLinesOf({ packageName, against, changes }: Checked): readonly string[] {
  const opening =
    against.kind === 'none'
      ? `${packageName} has no Baseline: ${reasonOf(against.why)}`
      : `Checked against ${packageName}@${against.version}${versionNoteOf(against)}`;
  return [opening, ...changes.map(changeLineOf)];
}

/** What the opening line says of the Baseline beyond its version: that `--against` named it, or where a version derives from. */
function versionNoteOf(against: Extract<Checked['against'], { kind: 'baseline' }>): string {
  if (against.chosen === 'against') {
    return ' (--against)';
  }
  if (against.stable === against.version) {
    return '';
  }
  return against.stable === undefined
    ? ` (no stable version: the first is ${firstStableOf(against.version)})`
    : ` (version from ${against.stable})`;
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
  changes: readonly CheckedChange[],
  status: Ending['status'],
): string[] {
  if (changes.length === 0) {
    return [`No Change against ${compared}`];
  }
  return status === 0 ? ['No Change needs a Breaking Change Approval'] : [];
}
