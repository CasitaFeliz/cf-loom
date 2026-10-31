import {
  chainDown,
  refNameOf,
  type SchemaNode,
  type Step,
  type StepChain,
  stepListOf,
} from '../walker/index.ts';
import { annotationFindingsOf, renamedFindingsOf } from './annotations.ts';
import { arrayFindingsOf, recordFindingsOf, tupleFindingsOf } from './collections.ts';
import { numberFindingsOf, stringFindingsOf } from './constraints.ts';
import { isUnchangedRefPair, plainUnionFindingsOf } from './def-comparison.ts';
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
import { type Entered, hasEntered, hopOf } from './refs.ts';
import type { Difference, EndpointPosition, Position } from './report.ts';
import { taggedFindingsOf } from './unions.ts';

/** Where a schema sits: the Position it is read in, and its steps from the site. */
export type SchemaPlace = { readonly position: Position; readonly at: readonly Step[] };

/**
 * Where a schema read as Input or Success sits: an Endpoint's part, a Guard's demand or a
 * Rejection's body; never a Message's or a shared schema's.
 */
export type EndpointPlace = { readonly position: EndpointPosition; readonly at: readonly Step[] };

/**
 * A place with the pairs a `ref` already led to within its root schema, one map shared by every
 * place in it: a `ref` is compared where it sits, and the pair it leads to the first time that
 * pair is met, however many paths reach it. Its steps share those of the place it is inside, so a
 * pair one step further costs one step, however far down it is; they are from the site, or, inside
 * a def the proposed side reaches through a `ref`, from that def.
 */
type EnteredPlace = {
  readonly position: Position;
  readonly steps: StepChain;
  readonly def?: string;
  readonly entered: Entered;
};

/**
 * A pair and how it is met: where a schema is used, or one hop on from a pair holding a `ref`, at
 * the same path, each `ref` side the def it names and an inline side as it was.
 */
type Met = { readonly kind: 'use' | 'hop'; readonly pair: NodePair };

/**
 * A pair one hop on from a pair holding a `ref`, with the id of the def the proposed side's `ref`
 * names, none when the proposed side is written inline.
 */
type Hop = Met & { readonly kind: 'hop'; readonly def: string | undefined };

/**
 * Every difference in shape between a Baseline schema and its proposed one, depth first, each at
 * its path, following each `ref` one hop at a time into its Snapshot's defs. A `ref` is compared
 * where it sits, and the pair it leads to the first time that pair is met; what differs inside the
 * def the proposed side names is at its path from that def, so it reads the same whichever path
 * reaches the def first. A pair of `ref`s naming one def the def comparison finds nothing differing
 * in is not followed. A pair holds its steps shared with the pair it is inside and a difference
 * reads them as a list once.
 */
export function schemaDifferencesOf(
  pair: NodePair,
  defs: BothDefs,
  place: SchemaPlace,
): readonly Difference[] {
  const differences: Difference[] = [];
  const entry = {
    position: place.position,
    steps: chainDown(undefined, place.at),
    entered: new Map(),
  };
  const levels = [levelOf({ kind: 'use', pair }, defs, entry)];
  for (let level = levels.at(-1); level !== undefined; level = levels.at(-1)) {
    const next = level.findings.next();
    if (next.done === true) {
      levels.pop();
      continue;
    }
    const finding = next.value;
    switch (finding.kind) {
      case 'found':
        differences.push(differenceOf(level.place, finding));
        break;
      case 'inside': {
        const steps = chainDown(level.place.steps, finding.steps);
        levels.push(levelOf({ kind: 'use', pair: finding.pair }, defs, { ...level.place, steps }));
        break;
      }
      case 'hop':
        levels.push(levelOf(finding, defs, placeOfHop(level.place, finding)));
        break;
    }
  }
  return differences;
}

/** A finding as a Difference: its steps below the place, and the def the place is in, if any. */
function differenceOf(
  place: EnteredPlace,
  finding: Extract<Finding, { kind: 'found' }>,
): Difference {
  const at = stepListOf(chainDown(place.steps, finding.steps));
  const difference = {
    kind: 'schema',
    position: place.position,
    at,
    shape: finding.shape,
  } as const;
  return place.def === undefined ? difference : { ...difference, def: place.def };
}

/** The place a hop's pair is compared in: inside the def the proposed side names, from that def, else where the hop is. */
function placeOfHop(place: EnteredPlace, { def }: Hop): EnteredPlace {
  return def === undefined ? place : { ...place, steps: undefined, def };
}

/**
 * A pair being compared: its findings, read one at a time, so the pair of a finding inside it is
 * followed only once the findings before it are compared, as the walk meets it.
 */
type Level = { readonly findings: Iterator<Finding | Hop>; readonly place: EnteredPlace };

function levelOf(met: Met, defs: BothDefs, place: EnteredPlace): Level {
  return { findings: findingsWithin(met, defs, place).values(), place };
}

/**
 * What comparing a pair finds: its own annotations and def name, its nullability where it is a
 * use (a def is never nullable, each `ref` carries its use's), then its type, or, when a side is a
 * `ref`, the pair one hop on, unless that pair was already entered within the root schema or
 * names on both sides one def nothing differs in.
 */
function findingsWithin(
  { kind, pair }: Met,
  defs: BothDefs,
  place: EnteredPlace,
): readonly (Finding | Hop)[] {
  const own = [
    ...annotationFindingsOf(pair),
    ...renamedFindingsOf(pair),
    ...(kind === 'use' ? nullabilityFindingsOf(pair) : []),
  ];
  if (pair.baseline.type !== 'ref' && pair.proposed.type !== 'ref') {
    return [...own, ...typeFindingsOf(pair, defs)];
  }
  const hop = hopOf(pair, defs);
  if (isUnchangedRefPair(pair, defs) || hasEntered(place.entered, hop)) {
    return own;
  }
  const proposedEntered = place.entered.get(hop.baseline) ?? new Set<SchemaNode>();
  place.entered.set(hop.baseline, proposedEntered.add(hop.proposed));
  return [...own, { kind: 'hop', pair: hop, def: refNameOf(pair.proposed) }];
}

/**
 * The nullability of a node, then what its type compares: nullability is apart from the shape. A
 * former Input is grafted by the same findings, so it pairs nodes as the compare does.
 */
export function findingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
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
