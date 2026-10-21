import { canonicalJson, type NumberNode, type StringNode } from '../walker/index.ts';
import { isMultipleOf } from './decimals.ts';
import { type Finding, found, type NodePairOf } from './findings.ts';
import type { Constraint, ShapeDifference } from './report.ts';

/** The bounds of a number's value, a string's length or an array's item count. */
type Bounds = Pick<NumberNode, 'min' | 'max' | 'exclusiveMin' | 'exclusiveMax'>;

type Bound = { readonly value: number; readonly inclusive: boolean };

type BoundSide = 'lower' | 'upper';

/** How a constraint present on both sides moved. */
type Movement = 'same' | 'tightened' | 'relaxed' | 'replaced';

type Replaceable = Extract<ShapeDifference, { kind: 'constraint-replaced' }>['constraint'];

type Values<Value> = { readonly baseline: Value | undefined; readonly proposed: Value | undefined };

/** How a string's constraints differ, each on its own: format with its options, regex, then its length. */
export function stringFindingsOf({ baseline, proposed }: NodePairOf<'string'>): readonly Finding[] {
  const formats = { baseline: formatKeyOf(baseline), proposed: formatKeyOf(proposed) };
  const regexes = { baseline: regexKeyOf(baseline), proposed: regexKeyOf(proposed) };
  return [
    ...changeFindingsOf('format', formats, replacedUnlessEqual),
    ...changeFindingsOf('regex', regexes, replacedUnlessEqual),
    ...boundFindingsOf(baseline, proposed),
  ];
}

/**
 * How a number's constraints differ, each on its own: `int`, its bounds, then `multipleOf`.
 * Constraints that mean the same thing written differently, such as `int` and `multipleOf: 1`,
 * are reported as changes, since what cannot be proven compatible is Breaking.
 */
export function numberFindingsOf({ baseline, proposed }: NodePairOf<'number'>): readonly Finding[] {
  const multiples = { baseline: baseline.multipleOf, proposed: proposed.multipleOf };
  return [
    ...intFindingsOf(baseline, proposed),
    ...boundFindingsOf(baseline, proposed),
    ...changeFindingsOf('multipleOf', multiples, multipleOfMovement),
  ];
}

/**
 * How the lower and upper bounds of two nodes differ: an exclusive bound is the same bound as the
 * inclusive one of its value, only tighter.
 */
export function boundFindingsOf(baseline: Bounds, proposed: Bounds): readonly Finding[] {
  return [
    ...boundSideFindingsOf('lower', boundOf(baseline, 'lower'), boundOf(proposed, 'lower')),
    ...boundSideFindingsOf('upper', boundOf(baseline, 'upper'), boundOf(proposed, 'upper')),
  ];
}

function tightened(constraint: Constraint): Finding {
  return found({ kind: 'constraint-tightened', constraint });
}

function relaxed(constraint: Constraint): Finding {
  return found({ kind: 'constraint-relaxed', constraint });
}

function intFindingsOf(baseline: NumberNode, proposed: NumberNode): readonly Finding[] {
  if (baseline.int === proposed.int) {
    return [];
  }
  return [proposed.int === undefined ? relaxed('int') : tightened('int')];
}

/** A constraint added tightens and one removed relaxes; when both sides have one, `movement` says how it moved. */
function changeFindingsOf<Value>(
  constraint: Replaceable,
  { baseline, proposed }: Values<Value>,
  movement: (baseline: Value, proposed: Value) => Movement,
): readonly Finding[] {
  if (baseline === undefined) {
    return proposed === undefined ? [] : [tightened(constraint)];
  }
  if (proposed === undefined) {
    return [relaxed(constraint)];
  }
  switch (movement(baseline, proposed)) {
    case 'same':
      return [];
    case 'tightened':
      return [tightened(constraint)];
    case 'relaxed':
      return [relaxed(constraint)];
    case 'replaced':
      return [found({ kind: 'constraint-replaced', constraint })];
  }
}

function formatKeyOf(node: StringNode): string | undefined {
  if (node.format === undefined) {
    return undefined;
  }
  return canonicalJson({ format: node.format, formatOptions: node.formatOptions ?? {} });
}

function regexKeyOf(node: StringNode): string | undefined {
  return node.regex === undefined ? undefined : canonicalJson(node.regex);
}

function replacedUnlessEqual(baseline: string, proposed: string): Movement {
  return baseline === proposed ? 'same' : 'replaced';
}

/** A multiple of the old value admits fewer values, a divisor of it more, any other number neither. */
function multipleOfMovement(baseline: number, proposed: number): Movement {
  if (baseline === proposed) {
    return 'same';
  }
  if (isMultipleOf(proposed, baseline)) {
    return 'tightened';
  }
  return isMultipleOf(baseline, proposed) ? 'relaxed' : 'replaced';
}

function boundOf(node: Bounds, boundSide: BoundSide): Bound | undefined {
  const [inclusive, exclusive] =
    boundSide === 'lower' ? [node.min, node.exclusiveMin] : [node.max, node.exclusiveMax];
  if (inclusive !== undefined) {
    return { value: inclusive, inclusive: true };
  }
  return exclusive === undefined ? undefined : { value: exclusive, inclusive: false };
}

function boundSideFindingsOf(
  boundSide: BoundSide,
  baseline: Bound | undefined,
  proposed: Bound | undefined,
): readonly Finding[] {
  const constraint = boundSide === 'lower' ? 'lower-bound' : 'upper-bound';
  if (isTighter(proposed, baseline, boundSide)) {
    return [tightened(constraint)];
  }
  return isTighter(baseline, proposed, boundSide) ? [relaxed(constraint)] : [];
}

/** Whether a bound admits fewer values than another; no bound at all admits the most. */
function isTighter(
  bound: Bound | undefined,
  than: Bound | undefined,
  boundSide: BoundSide,
): boolean {
  if (bound === undefined) {
    return false;
  }
  if (than === undefined) {
    return true;
  }
  const isStricterValue =
    boundSide === 'lower' ? bound.value > than.value : bound.value < than.value;
  const isStricterKind = bound.value === than.value && !bound.inclusive && than.inclusive;
  return isStricterValue || isStricterKind;
}
