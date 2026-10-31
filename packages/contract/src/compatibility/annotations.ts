import { canonicalJson, childrenOf, neutralAnnotations, refNameOf } from '../walker/index.ts';
import { type Finding, found, type NodePair } from './findings.ts';

/** A Neutral annotation: `description`, `examples` or `origin`. */
export type Annotation = (typeof neutralAnnotations)[number];

/** The Neutral annotations two nodes differ in, in order: description, examples, then origin. */
export function annotationFindingsOf(pair: NodePair): readonly Finding[] {
  return differingAnnotationsOf(pair).map((annotation) =>
    found({ kind: 'annotation-changed', annotation }),
  );
}

/**
 * The def name a `ref` carries, a use's or an alias def's, when it differs: another def's, or none
 * where the other side is not a `ref`. The name is an annotation (`.meta({ id })`), never a shape.
 */
export function renamedFindingsOf({ baseline, proposed }: NodePair): readonly Finding[] {
  const isRenamed = refNameOf(baseline) !== refNameOf(proposed);
  return isRenamed ? [found({ kind: 'annotation-changed', annotation: 'id' })] : [];
}

/**
 * The Neutral annotations that differ inside two nodes of one shape, the two nodes themselves left
 * out and no def entered; both sides are read in lockstep, a child by its steps, so a moved
 * annotation is one that differs.
 */
export function annotationsInside(pair: NodePair): ReadonlySet<Annotation> {
  const changed = new Set<Annotation>();
  const pending: NodePair[] = [];
  pushChildPairs(pending, pair);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const annotation of differingAnnotationsOf(next)) {
      changed.add(annotation);
    }
    pushChildPairs(pending, next);
  }
  return changed;
}

/** The Neutral annotations two nodes differ in, in order: description, examples, then origin. */
export function differingAnnotationsOf({ baseline, proposed }: NodePair): readonly Annotation[] {
  return neutralAnnotations.filter(
    (annotation) => canonicalJson(baseline[annotation]) !== canonicalJson(proposed[annotation]),
  );
}

/** Pushes the children of two nodes of one shape, paired by the steps that lead to them. */
function pushChildPairs(pending: NodePair[], { baseline, proposed }: NodePair): void {
  const proposedBySteps = new Map(
    childrenOf(proposed).map((child) => [canonicalJson(child.steps), child.node]),
  );
  for (const child of childrenOf(baseline)) {
    const counterpart = proposedBySteps.get(canonicalJson(child.steps));
    if (counterpart === undefined) {
      throw new Error('Two nodes of one shape hold different children: a bug.');
    }
    pending.push({ baseline: child.node, proposed: counterpart });
  }
}
