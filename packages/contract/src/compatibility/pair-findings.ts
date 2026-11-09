import type { SchemaNode } from '../walker/index.ts';
import { annotationFindingsOf, renamedFindingsOf } from './annotations.ts';
import { arrayFindingsOf, recordFindingsOf, tupleFindingsOf } from './collections.ts';
import { numberFindingsOf, stringFindingsOf } from './constraints.ts';
import { plainUnionFindingsOf } from './def-comparison.ts';
import { enumFindingsOf } from './enums.ts';
import { objectFindingsOf } from './fields.ts';
import {
  type BothDefs,
  type Finding,
  found,
  type NodePair,
  type NodePairOf,
  typeChanged,
} from './findings.ts';
import { taggedFindingsOf } from './unions.ts';

/**
 * What comparing a pair finds in itself: its Neutral annotations and def name, its nullability
 * where it is a use, then, when neither side is a `ref`, what its type compares; a pair holding a
 * `ref` finds only its own, and the walk follows the hop.
 */
export function findingsOf(pair: NodePair, defs: BothDefs, met: 'use' | 'hop'): readonly Finding[] {
  const own = [
    ...annotationFindingsOf(pair),
    ...renamedFindingsOf(pair),
    ...(met === 'use' ? nullabilityFindingsOf(pair) : []),
  ];
  if (pair.baseline.type === 'ref' || pair.proposed.type === 'ref') {
    return own;
  }
  return [...own, ...typeFindingsOf(pair, defs)];
}

/**
 * Nullability is compared on every node, `json` included, which already admits `null`: that
 * over-reports a change, which errs toward Breaking.
 */
function nullabilityFindingsOf({ baseline, proposed }: NodePair): readonly Finding[] {
  if (baseline.nullable === proposed.nullable) {
    return [];
  }
  return [found({ kind: proposed.nullable ? 'nullability-added' : 'nullability-removed' })];
}

function typeFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  if (pair.baseline.type === 'enum' || pair.proposed.type === 'enum') {
    return enumFindingsOf(pair);
  }
  return pair.baseline.type === pair.proposed.type
    ? sameTypeFindingsOf(pair, defs)
    : [typeChanged(pair)];
}

function isNodePairOf<Type extends SchemaNode['type']>(
  pair: NodePair,
  type: Type,
): pair is NodePairOf<Type> {
  return pair.baseline.type === type && pair.proposed.type === type;
}

/**
 * Two nodes of one type, with every `ref` already followed. A `boolean` and `json` have no shape
 * beyond their type; a plain union and an intersection that is not of objects are Breaking when
 * anything in them changes.
 */
function sameTypeFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  if (isNodePairOf(pair, 'object')) {
    return objectFindingsOf(pair);
  }
  if (isNodePairOf(pair, 'tagged')) {
    return taggedFindingsOf(pair);
  }
  if (isNodePairOf(pair, 'string')) {
    return stringFindingsOf(pair);
  }
  if (isNodePairOf(pair, 'number')) {
    return numberFindingsOf(pair);
  }
  if (isNodePairOf(pair, 'array')) {
    return arrayFindingsOf(pair);
  }
  if (isNodePairOf(pair, 'record')) {
    return recordFindingsOf(pair);
  }
  if (isNodePairOf(pair, 'tuple')) {
    return tupleFindingsOf(pair, defs);
  }
  if (isNodePairOf(pair, 'union')) {
    return plainUnionFindingsOf(pair, defs, { kind: 'union-changed' });
  }
  if (isNodePairOf(pair, 'allOf')) {
    return plainUnionFindingsOf(pair, defs, { kind: 'unproven', node: 'allOf' });
  }
  return [];
}
