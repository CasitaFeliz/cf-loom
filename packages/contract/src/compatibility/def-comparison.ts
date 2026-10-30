import {
  closureFactsOf,
  type Defs,
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
  const differing = new Set<Fact>(annotationsInside(pair));
  const reached = refsWrittenIn(pair.baseline);
  if (reached.length === 0) {
    return differing;
  }
  const comparison = comparisonOf(defs);
  for (const name of reached) {
    for (const fact of comparison.get(name) ?? unknownDef) {
      differing.add(fact);
    }
  }
  return differing;
}

function comparisonOf({ baseline, proposed }: BothDefs): DefComparison {
  const byProposed = comparisons.get(baseline) ?? new WeakMap<Defs, DefComparison>();
  comparisons.set(baseline, byProposed);
  const known = byProposed.get(proposed);
  if (known !== undefined) {
    return known;
  }
  const built = closureFactsOf(baseline, (name, def) => ownFactsOf(name, def, proposed));
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
  proposedDefs: Defs,
): readonly Fact[] {
  const proposed = Object.hasOwn(proposedDefs, name) ? proposedDefs[name] : undefined;
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
