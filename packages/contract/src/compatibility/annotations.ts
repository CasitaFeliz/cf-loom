import { canonicalJson, childrenOf, type SchemaNode } from '../walker/index.ts';
import { type BothDefs, type Finding, found, type NodePair } from './findings.ts';

const annotations = ['description', 'examples', 'origin'] as const;

type Annotation = (typeof annotations)[number];

/** The Neutral annotations two nodes differ in, in order: description, examples, then origin. */
export function annotationFindingsOf({ baseline, proposed }: NodePair): readonly Finding[] {
  const changed = annotations.filter(
    (annotation) => canonicalJson(baseline[annotation]) !== canonicalJson(proposed[annotation]),
  );
  return changed.map((annotation) => found({ kind: 'annotation-changed', annotation }));
}

/**
 * The def's name a use carries, when it differs: another def's, or none where the shape is now
 * written inline, or one where it was. The name is an annotation (`.meta({ id })`), never a shape.
 */
export function renamedFindingsOf({ baseline, proposed }: NodePair): readonly Finding[] {
  const isRenamed = defNameOf(baseline) !== defNameOf(proposed);
  return isRenamed ? [found({ kind: 'annotation-changed', annotation: 'id' })] : [];
}

function defNameOf(node: SchemaNode): string | undefined {
  return node.type === 'ref' ? node.name : undefined;
}

/**
 * The Neutral annotations that differ anywhere inside two nodes of one shape, such as a plain
 * union's options and the defs they reach, each once, at the nodes' own path; both sides are read
 * in lockstep, a child by its steps and a def by its name, so a moved annotation is one that differs.
 */
export function innerAnnotationFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  const changed = new Set<Annotation>();
  const entered = new Set<string>();
  const pending: NodePair[] = [];
  pushChildPairs(pending, pair);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const annotation of differingAnnotationsOf(next)) {
      changed.add(annotation);
    }
    pushChildPairs(pending, next);
    if (next.baseline.type === 'ref' && !entered.has(next.baseline.name)) {
      entered.add(next.baseline.name);
      pending.push(defPairOf(next.baseline.name, defs));
    }
  }
  const inOrder = annotations.filter((annotation) => changed.has(annotation));
  return inOrder.map((annotation) => found({ kind: 'annotation-changed', annotation }));
}

function differingAnnotationsOf({ baseline, proposed }: NodePair): readonly Annotation[] {
  return annotations.filter(
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

function defPairOf(name: string, defs: BothDefs): NodePair {
  const baseline = defs.baseline[name];
  const proposed = defs.proposed[name];
  if (baseline === undefined || proposed === undefined) {
    throw new Error(`\`ref\` to ${name} reaches no schema on both sides: a bug.`);
  }
  return { baseline, proposed };
}
