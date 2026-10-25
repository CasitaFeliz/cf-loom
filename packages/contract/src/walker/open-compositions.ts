import { type LocatedNode, nodesReachedFrom, nodesWithin } from './children.ts';
import type { AllOfNode, NotAllowed, Path, SchemaNode, UnionNode } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * Every outermost `allOf` or `union` in the schemas, or in a def at `['defs', <id>]`, that reaches
 * an Open Enum: a reader of an intersection merges what each item read, and a reader of a union
 * takes the first option that parses, and neither can tell an Unknown case from a value another
 * part declares. Each def is judged once, where it is, whether or not the schemas using it walked.
 */
export function openCompositionsOf(
  schemas: readonly LocatedNode[],
  defs: Defs,
): readonly NotAllowed[] {
  const located = [...schemas, ...Object.entries(defs).map(([id, def]) => defAt(id, def))];
  const reported: NotAllowed[] = [];
  for (const { at, node } of located.flatMap((schema) => nodesWithin(schema.node, schema.at))) {
    const isInsideReported = reported.some((outer) => isInside(at, outer.at));
    if (isComposition(node) && !isInsideReported && reachesOpen({ at, node }, defs)) {
      reported.push({ kind: 'not-allowed', at, ...refusalOf(node) });
    }
  }
  return reported;
}

function isComposition(node: SchemaNode): node is AllOfNode | UnionNode {
  return node.type === 'allOf' || node.type === 'union';
}

function refusalOf(composition: AllOfNode | UnionNode): Refused {
  return composition.type === 'allOf' ? refused.openIntersection : refused.openUnion;
}

function defAt(id: string, def: LocatedNode['node']): LocatedNode {
  return { at: ['defs', id], node: def };
}

/** Whether a path lies under another, which the walk of nodes lists first. */
function isInside(at: Path, outer: Path): boolean {
  return outer.length < at.length && outer.every((step, index) => at[index] === step);
}

/** Whether a node reaches an Open Enum, through `ref`s. */
function reachesOpen(located: LocatedNode, defs: Defs): boolean {
  return nodesReachedFrom([located], defs).some(isOpenEnum);
}

function isOpenEnum({ node }: LocatedNode): boolean {
  return node.type === 'enum' && node.open;
}
