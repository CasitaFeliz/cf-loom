import type { SchemaNode } from '../walker/index.ts';
import { arrayFindingsOf, recordFindingsOf, tupleFindingsOf } from './collections.ts';
import { numberFindingsOf, stringFindingsOf } from './constraints.ts';
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
import { type EnteredKey, followedOf } from './refs.ts';
import type { Difference, EndpointPosition, Position } from './report.ts';
import type { Step } from './steps.ts';
import { plainUnionFindingsOf, taggedFindingsOf } from './unions.ts';

/** Where a schema sits: the Position it is read in, and its steps from the site. */
export type SchemaPlace = { readonly position: Position; readonly at: readonly Step[] };

/**
 * Where a schema read as Input or Success sits: an Endpoint's part, a Guard's demand or a
 * Rejection's body; never a Message's or a shared schema's.
 */
export type EndpointPlace = { readonly position: EndpointPosition; readonly at: readonly Step[] };

/**
 * A place with the keys of the pairs already entered within its root schema, one list shared by
 * every place in it, so a pair is compared once however many paths reach it.
 */
type EnteredPlace = SchemaPlace & { readonly entered: EnteredKey[] };

/**
 * Every difference in shape between a Baseline schema and its proposed one, depth first, each at
 * its path, following `ref`s into both Snapshots' defs. A pair of schemas met again within this
 * schema compares no further, so a def used at several paths reports its differences at the first.
 */
export function schemaDifferencesOf(
  pair: NodePair,
  defs: BothDefs,
  place: SchemaPlace,
): readonly Difference[] {
  return differencesWithin(pair, defs, { ...place, entered: [] });
}

function differencesWithin(
  pair: NodePair,
  defs: BothDefs,
  place: EnteredPlace,
): readonly Difference[] {
  const followed = followedOf(pair, defs, place.entered);
  switch (followed.kind) {
    case 'settled':
      return differencesOf(nullabilityFindingsOf(followed.pair), defs, place);
    case 'inline':
      return differencesOf(findingsOf(followed.pair, defs), defs, place);
    case 'entered':
      place.entered.push(followed.entered);
      return differencesOf(findingsOf(followed.pair, defs), defs, place);
  }
}

function differencesOf(
  findings: readonly Finding[],
  defs: BothDefs,
  place: EnteredPlace,
): readonly Difference[] {
  const differences: Difference[] = [];
  for (const finding of findings) {
    const at = [...place.at, ...finding.steps];
    switch (finding.kind) {
      case 'found':
        differences.push({ kind: 'schema', position: place.position, at, shape: finding.shape });
        break;
      case 'inside':
        differences.push(...differencesWithin(finding.pair, defs, { ...place, at }));
        break;
    }
  }
  return differences;
}

/** The nullability of a node, then what its type compares: nullability is apart from the shape. */
function findingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  return [...nullabilityFindingsOf(pair), ...typeFindingsOf(pair, defs)];
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
