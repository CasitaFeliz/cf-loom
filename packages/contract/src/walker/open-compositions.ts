import { nodesReachedFrom } from './children.ts';
import type { AllOfNode, NotAllowed, SchemaNode, UnionNode } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';
import type { Composition, Reached } from './walked.ts';

/**
 * Every `allOf` or `union` the walk built that reaches an Open Enum, at any depth: a reader of an
 * intersection merges what each item read, and a reader of a union takes the first option that
 * parses, and neither can tell an Unknown case from a value another part declares. Each is
 * judged where the walk built it, a def's at every place the walk met the def.
 */
export function openCompositionsOf(
  compositions: readonly Composition[],
  defs: Defs,
): readonly NotAllowed[] {
  return compositions.filter(({ node }) => reachesOpen(node, defs)).map(({ refusal }) => refusal);
}

/** A composition the walk built where it stands, with the refusal it is if it reaches an Open Enum. */
export function compositionOf(at: Reached, node: AllOfNode | UnionNode): Composition {
  return { refusal: { kind: 'not-allowed', ...at, ...refusalOf(node) }, node };
}

function refusalOf(composition: AllOfNode | UnionNode): Refused {
  return composition.type === 'allOf' ? refused.openIntersection : refused.openUnion;
}

/** Whether a node reaches an Open Enum, through `ref`s. */
function reachesOpen(node: SchemaNode, defs: Defs): boolean {
  return nodesReachedFrom([node], defs).some(isOpenEnum);
}

function isOpenEnum(node: SchemaNode): boolean {
  return node.type === 'enum' && node.open;
}
