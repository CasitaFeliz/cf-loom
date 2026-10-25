import type { TupleNode } from '../walker/index.ts';
import { boundFindingsOf } from './constraints.ts';
import { type BothDefs, type Finding, found, inside, type NodePairOf } from './findings.ts';
import { itemsStep, keyStep, restStep, valueStep } from './steps.ts';
import { plainUnionFindingsOf } from './unions.ts';

/** An array's item counts under the constraint rules, then its items under the field rules. */
export function arrayFindingsOf({ baseline, proposed }: NodePairOf<'array'>): readonly Finding[] {
  return [
    ...boundFindingsOf(baseline, proposed),
    inside(baseline.items, proposed.items, [itemsStep]),
  ];
}

/** A record's key under the constraint rules and its value under the field rules. */
export function recordFindingsOf({ baseline, proposed }: NodePairOf<'record'>): readonly Finding[] {
  return [
    inside(baseline.key, proposed.key, [keyStep]),
    inside(baseline.value, proposed.value, [valueStep]),
  ];
}

/**
 * A tuple's items under the plain-union rule, then its `rest`: added, removed, or compared like an
 * array's items.
 */
export function tupleFindingsOf(pair: NodePairOf<'tuple'>, defs: BothDefs): readonly Finding[] {
  const baseline = withoutRest(pair.baseline);
  const proposed = withoutRest(pair.proposed);
  const items = plainUnionFindingsOf({ baseline, proposed }, defs, {
    kind: 'unproven',
    node: 'tuple',
  });
  return [...items, ...restFindingsOf(pair)];
}

function withoutRest(tuple: TupleNode): TupleNode {
  const { rest: _rest, ...items } = tuple;
  return items;
}

function restFindingsOf({ baseline, proposed }: NodePairOf<'tuple'>): readonly Finding[] {
  const steps = [restStep];
  if (baseline.rest === undefined) {
    return proposed.rest === undefined ? [] : [found({ kind: 'rest-added' }, steps)];
  }
  if (proposed.rest === undefined) {
    return [found({ kind: 'rest-removed' }, steps)];
  }
  return [inside(baseline.rest, proposed.rest, steps)];
}
