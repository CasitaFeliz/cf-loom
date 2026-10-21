import { reachedDefsOf, shapeKey } from '../walker/index.ts';
import {
  type BothDefs,
  type Finding,
  found,
  type NodePair,
  shapeKeyBesidesNullability,
} from './findings.ts';

/**
 * How two `ref`s differ: not at all when they are unchanged, else one change no rule proves
 * compatible, a `ref` against an inline schema included.
 */
export function refFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  return isUnchanged(pair, defs) ? [] : [found({ kind: 'unproven', node: 'ref' })];
}

/**
 * Whether two nodes have the same shape, apart from their own nullability, and every def their
 * `ref`s reach has the same shape on both sides. No def is entered, so no cycle can arise.
 */
export function isUnchanged({ baseline, proposed }: NodePair, defs: BothDefs): boolean {
  const hasSameShape =
    shapeKeyBesidesNullability(baseline) === shapeKeyBesidesNullability(proposed);
  return (
    hasSameShape && reachedDefsOf([baseline], defs.baseline).every((name) => hasSameDef(name, defs))
  );
}

function hasSameDef(name: string, defs: BothDefs): boolean {
  const baseline = defs.baseline[name];
  const proposed = defs.proposed[name];
  return (
    baseline !== undefined && proposed !== undefined && shapeKey(baseline) === shapeKey(proposed)
  );
}
