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

/** What differs in a def or in a def it reaches: its shape, or a Neutral annotation. */
type Fact = 'changed' | Annotation;

/** Each def's facts together with those of every def it reaches, by name. */
type DefComparison = ReadonlyMap<string, ReadonlySet<Fact>>;

/**
 * The comparison of each pair of `Defs` values, by the Baseline's and then the proposed one: a
 * `Defs` is never changed once built, so the pair's answers hold for every question about it.
 */
const comparisons = new WeakMap<Defs, WeakMap<Defs, DefComparison>>();

/**
 * Whether two nodes have the same shape, apart from their own nullability, and every def their
 * `ref`s reach has the same shape on both sides. No def is compared by Position.
 */
export function isUnchanged(pair: NodePair, defs: BothDefs): boolean {
  const hasSameShape =
    shapeKeyBesidesNullability(pair.baseline) === shapeKeyBesidesNullability(pair.proposed);
  const reached = refsWrittenIn(pair.baseline);
  if (!hasSameShape || reached.length === 0) {
    return hasSameShape;
  }
  const comparison = comparisonOf(defs);
  return reached.every((name) => comparison.get(name)?.has('changed') === false);
}

/**
 * The Neutral annotations that differ anywhere inside two nodes of one shape, such as a plain
 * union's options and the defs they reach, each once, at the nodes' own path; a moved annotation
 * is one that differs.
 */
export function innerAnnotationFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  const changed = new Set<Fact>(annotationsInside(pair));
  const reached = refsWrittenIn(pair.baseline);
  const comparison = reached.length === 0 ? undefined : comparisonOf(defs);
  for (const name of reached) {
    for (const fact of comparison?.get(name) ?? []) {
      changed.add(fact);
    }
  }
  const inOrder = neutralAnnotations.filter((annotation) => changed.has(annotation));
  return inOrder.map((annotation) => found({ kind: 'annotation-changed', annotation }));
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
    return ['changed'];
  }
  const pair = { baseline, proposed };
  return [...new Set([...differingAnnotationsOf(pair), ...annotationsInside(pair)])];
}
