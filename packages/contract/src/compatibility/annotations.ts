import {
  canonicalJson,
  type Defs,
  nodesReachedFrom,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
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
 * The Neutral annotations that differ anywhere inside two nodes compared as a whole, such as a
 * plain union's options and the defs they reach, each once, at the nodes' own path; a node is told
 * apart by its shape, so reordering equal items moves no annotation.
 */
export function innerAnnotationFindingsOf(pair: NodePair, defs: BothDefs): readonly Finding[] {
  const before = innerNodesOf(pair.baseline, defs.baseline);
  const after = innerNodesOf(pair.proposed, defs.proposed);
  const changed = annotations.filter(
    (annotation) => heldIn(before, annotation) !== heldIn(after, annotation),
  );
  return changed.map((annotation) => found({ kind: 'annotation-changed', annotation }));
}

function innerNodesOf(node: SchemaNode, defs: Defs): readonly SchemaNode[] {
  const reached = nodesReachedFrom([{ at: [], node }], defs);
  return reached.slice(1).map((located) => located.node);
}

/** The annotations the nodes hold, each with the shape of its node, in an order that means nothing. */
function heldIn(nodes: readonly SchemaNode[], annotation: Annotation): string {
  const held = nodes
    .filter((node) => node[annotation] !== undefined)
    .map((node) => canonicalJson([shapeKey(node), node[annotation]]));
  return held.sort().join('\n');
}
