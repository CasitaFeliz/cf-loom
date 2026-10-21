import type { Path, SchemaNode } from '../walker/index.ts';
import { enumFindingsOf, isEnumLike } from './enums.ts';
import { objectFindingsOf } from './fields.ts';
import {
  type BothDefs,
  type Finding,
  found,
  inside,
  type NodePair,
  type PairOf,
  typeChanged,
} from './findings.ts';
import { isUnchanged, refFindingsOf } from './refs.ts';
import type { Difference, PositionOrEvery } from './report.ts';
import { taggedFindingsOf, unionFindingsOf } from './unions.ts';

/** Where a schema sits: the Position it is read in, and its path from the site. */
export type SchemaPlace = { readonly position: PositionOrEvery; readonly at: Path };

/**
 * Every difference in shape between a Baseline schema and its proposed one, depth first, each at
 * its path. `ref`s are not followed, so no cycle can arise.
 */
export function schemaDifferencesOf(
  pair: NodePair,
  defs: BothDefs,
  place: SchemaPlace,
): readonly Difference[] {
  const differences: Difference[] = [];
  for (const finding of findingsOf(pair, defs)) {
    const at = [...place.at, ...finding.steps];
    switch (finding.kind) {
      case 'found':
        differences.push({ kind: 'schema', position: place.position, at, shape: finding.shape });
        break;
      case 'inside':
        differences.push(...schemaDifferencesOf(finding.pair, defs, { ...place, at }));
        break;
    }
  }
  return differences;
}

/** The nullability of a node, then what its type compares: nullability is apart from the shape. */
function findingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  return [...nullabilityFindingsOf(pair), ...typeFindingsOf(pair, defs)];
}

function nullabilityFindingsOf({ baseline, proposed }: NodePair): readonly Finding[] {
  if (baseline.nullable === proposed.nullable) {
    return [];
  }
  return [found({ kind: proposed.nullable ? 'nullability-added' : 'nullability-removed' })];
}

function typeFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  if (pair.baseline.type === 'ref' || pair.proposed.type === 'ref') {
    return refFindingsOf(pair, defs);
  }
  if (isEnumLike(pair.baseline) || isEnumLike(pair.proposed)) {
    return enumFindingsOf(pair);
  }
  return pair.baseline.type === pair.proposed.type
    ? sameTypeFindingsOf(pair, defs)
    : [typeChanged(pair)];
}

function isPairOf<Type extends SchemaNode['type']>(
  pair: NodePair,
  type: Type,
): pair is PairOf<Type> {
  return pair.baseline.type === type && pair.proposed.type === type;
}

/**
 * Two nodes of one type. What no rule here compares, the constraints of a string or a number, a
 * record, a tuple and an intersection, is one change no rule proves compatible when their shapes
 * differ.
 */
function sameTypeFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  if (isPairOf(pair, 'object')) {
    return objectFindingsOf(pair);
  }
  if (isPairOf(pair, 'tagged')) {
    return taggedFindingsOf(pair);
  }
  if (isPairOf(pair, 'array')) {
    return arrayFindingsOf(pair);
  }
  if (isPairOf(pair, 'union')) {
    return unionFindingsOf(pair, defs);
  }
  return isUnchanged(pair, defs) ? [] : [found({ kind: 'unproven', node: pair.baseline.type })];
}

/** An array's items follow the field rules; its item counts are constraints no rule here compares. */
function arrayFindingsOf({ baseline, proposed }: PairOf<'array'>): readonly Finding[] {
  const hasSameCounts = baseline.min === proposed.min && baseline.max === proposed.max;
  const counts = hasSameCounts ? [] : [found({ kind: 'unproven', node: 'array' })];
  return [...counts, inside(baseline.items, proposed.items, ['items'])];
}
