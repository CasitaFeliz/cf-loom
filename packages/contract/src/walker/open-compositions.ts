import { type LocatedNode, nodesReachedFrom, nodesWithin } from './children.ts';
import { inside, type Place, placeOf } from './location.ts';
import type { AllOfNode, NotAllowed, SchemaNode, UnionNode } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/** A schema's node and the place it sits in. */
type PlacedNode = { readonly at: Place; readonly node: SchemaNode };

/**
 * Every outermost `allOf` or `union` in the schemas, or in a def, that reaches an Open Enum: a
 * reader of an intersection merges what each item read, and a reader of a union takes the first
 * option that parses, and neither can tell an Unknown case from a value another part declares.
 * Each def is judged once, where it is, whether or not the schemas using it walked.
 */
export function openCompositionsOf(
  schemas: readonly PlacedNode[],
  defs: Defs,
): readonly NotAllowed[] {
  const defNodes = Object.entries(defs).map(([name, def]) => defAt(name, def));
  const reported: NotAllowed[] = [];
  for (const { at, node: root } of [...schemas, ...defNodes]) {
    for (const found of nodesWithin(root)) {
      const place = inside(at, ...found.at);
      const isInsideReported = reported.some((outer) => isInside(place, outer));
      if (isComposition(found.node) && !isInsideReported && reachesOpen(found, defs)) {
        reported.push({ kind: 'not-allowed', ...place, ...refusalOf(found.node) });
      }
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

function defAt(name: string, def: SchemaNode): PlacedNode {
  return { at: placeOf({ kind: 'def', name }, undefined), node: def };
}

/** Whether a place lies under another in the same declaration, which the walk of nodes lists first. */
function isInside(place: Place, outer: Place): boolean {
  const isSame = place.declaration === outer.declaration && sameSite(place, outer);
  return (
    isSame &&
    outer.steps.length < place.steps.length &&
    outer.steps.every((step, index) => JSON.stringify(step) === JSON.stringify(place.steps[index]))
  );
}

function sameSite(place: Place, other: Place): boolean {
  return JSON.stringify(place.site) === JSON.stringify(other.site);
}

/** Whether a node reaches an Open Enum, through `ref`s. */
function reachesOpen({ node }: LocatedNode, defs: Defs): boolean {
  return nodesReachedFrom([node], defs).some(isOpenEnum);
}

function isOpenEnum(node: SchemaNode): boolean {
  return node.type === 'enum' && node.open;
}
