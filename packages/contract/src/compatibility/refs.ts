import { byCodePoint, canonicalJson, reachedDefsOf, shapeKey } from '../walker/index.ts';
import { type BothDefs, type Finding, found, type NodePair } from './findings.ts';

/**
 * How two `ref`s differ. No def is entered: they are unchanged when both name the same def and
 * every def they reach has the same shape on both sides, and any other difference, a `ref` against
 * an inline schema included, is one change no rule proves compatible.
 */
export function refFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  return isUnchangedRef(pair, defs) ? [] : [found({ kind: 'unproven', node: 'ref' })];
}

function isUnchangedRef({ baseline, proposed }: NodePair, defs: BothDefs): boolean {
  if (baseline.type !== 'ref' || proposed.type !== 'ref' || baseline.name !== proposed.name) {
    return false;
  }
  const reachedBefore = reachedDefsOf([baseline], defs.baseline);
  const reachedAfter = reachedDefsOf([proposed], defs.proposed);
  return (
    sortedJson(reachedBefore) === sortedJson(reachedAfter) &&
    reachedBefore.every((name) => hasSameDef(name, defs))
  );
}

function sortedJson(names: readonly string[]): string {
  return canonicalJson([...names].sort(byCodePoint));
}

function hasSameDef(name: string, defs: BothDefs): boolean {
  const baseline = defs.baseline[name];
  const proposed = defs.proposed[name];
  return (
    baseline !== undefined && proposed !== undefined && shapeKey(baseline) === shapeKey(proposed)
  );
}
