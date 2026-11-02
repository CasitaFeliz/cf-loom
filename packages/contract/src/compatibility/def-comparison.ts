import {
  canonicalJson,
  type DefGraph,
  type Defs,
  defGraphOf,
  neutralAnnotations,
  refsWrittenIn,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
import { type Annotation, annotationsInside, differingAnnotationsOf } from './annotations.ts';
import {
  type BothDefs,
  type Finding,
  found,
  type NodePair,
  shapeKeyBesidesNullability,
} from './findings.ts';
import type { Compared } from './pairs.ts';
import type { ShapeDifference } from './shape-differences.ts';

/** What differs in a def or in a def it reaches: its shape, or a Neutral annotation. */
type Fact = 'changed' | Annotation;

/** Each def's facts together with those of every def it reaches, by name. */
type DefComparison = ReadonlyMap<string, ReadonlySet<Fact>>;

/** The facts of a def whose shape differs or that a side lacks, and of a name the comparison holds nothing for. */
const unknownDef: readonly Fact[] = ['changed'];

/**
 * The comparison of each pair of `Defs` values, by the Baseline's and then the proposed one: a
 * `Defs` is never changed once built, so the pair's answers hold for every question about it.
 */
const comparisons = new WeakMap<Defs, WeakMap<Defs, DefComparison>>();

/**
 * The plain-union rule: any change to two nodes' options or items, or to a def their `ref`s reach,
 * is the one `difference`, Breaking in every Position, since none can be proven compatible. Their
 * options compare in declared order, and an `allOf`'s items in shape order; a Neutral annotation
 * changes neither, and is told apart as Neutral.
 */
export function plainUnionFindingsOf(
  pair: NodePair,
  defs: BothDefs,
  difference: ShapeDifference,
): readonly Finding[] {
  const differing = differencesWithin(pair, defs);
  if (differing.has('changed')) {
    return [found(difference)];
  }
  const inOrder = neutralAnnotations.filter((annotation) => differing.has(annotation));
  return inOrder.map((annotation) => found({ kind: 'annotation-changed', annotation }));
}

/**
 * What differs inside two nodes, apart from their own annotations and nullability, and in every
 * def their `ref`s reach: `changed` when a shape does, else each Neutral annotation that does.
 * No def is compared by Position.
 */
function differencesWithin(pair: NodePair, defs: BothDefs): ReadonlySet<Fact> {
  const hasSameShape =
    shapeKeyBesidesNullability(pair.baseline) === shapeKeyBesidesNullability(pair.proposed);
  if (!hasSameShape) {
    return new Set<Fact>(['changed']);
  }
  return new Set<Fact>([...annotationsInside(pair), ...factsReachedBy([pair.baseline], defs)]);
}

/**
 * The facts of every def the nodes' `ref`s name, and every def those reach, merged: none exactly
 * when all are the same on both sides. A name the comparison holds nothing for is a change.
 */
function factsReachedBy(nodes: readonly SchemaNode[], defs: BothDefs): ReadonlySet<Fact> {
  const reached = nodes.flatMap(refsWrittenIn);
  const facts = new Set<Fact>();
  if (reached.length === 0) {
    return facts;
  }
  const comparison = comparisonOf(defs);
  for (const name of reached) {
    for (const fact of comparison.get(name) ?? unknownDef) {
      facts.add(fact);
    }
  }
  return facts;
}

function comparisonOf({ baseline, proposed }: BothDefs): DefComparison {
  const byProposed = comparisons.get(baseline) ?? new WeakMap<Defs, DefComparison>();
  comparisons.set(baseline, byProposed);
  const known = byProposed.get(proposed);
  if (known !== undefined) {
    return known;
  }
  const proposedGraph = defGraphOf(proposed);
  const built = defGraphOf(baseline).closureFacts((name, def) =>
    ownFactsOf(name, def, proposedGraph.def),
  );
  byProposed.set(proposed, built);
  return built;
}

/**
 * The facts a def holds in its own nodes: changed when a side holds no def of that name or the
 * shapes differ, otherwise the Neutral annotations that differ on it or inside it.
 */
function ownFactsOf(
  name: string,
  baseline: SchemaNode | undefined,
  proposedDef: DefGraph['def'],
): readonly Fact[] {
  const proposed = proposedDef(name);
  if (
    baseline === undefined ||
    proposed === undefined ||
    shapeKey(baseline) !== shapeKey(proposed)
  ) {
    return unknownDef;
  }
  const pair = { baseline, proposed };
  return [...differingAnnotationsOf(pair), ...annotationsInside(pair)];
}

/**
 * Whether every def the nodes' `ref`s name, and every def those reach, is the same on both sides:
 * the def comparison holds no fact for any of them. A name a side holds no def for is a change.
 */
function reachesOnlyUnchanged(nodes: readonly SchemaNode[], defs: BothDefs): boolean {
  return factsReachedBy(nodes, defs).size === 0;
}

/**
 * Whether two nodes are `ref`s naming one def that, with every def it reaches, is the same on both
 * sides, so no rule finds a Difference beyond the two `ref`s themselves.
 */
export function isUnchangedRefPair({ baseline, proposed }: NodePair, defs: BothDefs): boolean {
  return (
    baseline.type === 'ref' &&
    proposed.type === 'ref' &&
    baseline.name === proposed.name &&
    reachesOnlyUnchanged([baseline], defs)
  );
}

/**
 * Whether two values are the same canonical text and every def their schema nodes reach is the
 * same on both sides; the nodes are the Baseline's, whose `ref`s the proposed one writes alike.
 */
export function isSameReaching(
  { baseline, proposed }: Compared<unknown>,
  nodes: readonly SchemaNode[],
  defs: BothDefs,
): boolean {
  return canonicalJson(baseline) === canonicalJson(proposed) && reachesOnlyUnchanged(nodes, defs);
}
