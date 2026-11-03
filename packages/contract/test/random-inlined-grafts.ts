import type { Defs, ObjectNode, SchemaNode } from '../src/internal/index.ts';
import { namesReachedBy } from './graft-defs.ts';
import { aVersionOf, graftedIdentity } from './graft-fixtures.ts';
import { edgesOf } from './graft-sites.ts';
import { doubledGraftDrawOf } from './random-doubled-grafts.ts';
import { type Draft, nodesIn } from './random-draft.ts';
import type { GraftDraw } from './random-grafts.ts';
import { seededNext } from './random-schemas.ts';

/** A node with the way down from it to the `ref` replaced set at the last step. */
function putAt(parent: unknown, path: readonly (string | number)[], node: SchemaNode): void {
  let at = parent;
  for (const piece of path.slice(0, -1)) {
    at = Reflect.get(at as object, piece);
  }
  Reflect.set(at as object, path.at(-1) as string | number, node);
}

/** The `ref` to the def given a node's children hold at a step the graft enters, written as the def's node with the `ref`'s own annotations and nullability. */
function inlinedUsesIn(root: SchemaNode, name: string, def: SchemaNode): void {
  const pending = [root];
  for (let parent = pending.pop(); parent !== undefined; parent = pending.pop()) {
    for (const edge of edgesOf(parent).filter(({ isEntered }) => isEntered)) {
      if (edge.child.type !== 'ref' || edge.child.name !== name) {
        pending.push(edge.child);
        continue;
      }
      const { type: _type, name: _name, ...use } = edge.child;
      putAt(parent, edge.path, { ...structuredClone(def), ...use } as SchemaNode);
    }
  }
}

/** Whether a def reaches itself through `ref`s: an inline node cannot hold its own cycle. */
function isRecursive(name: string, defs: Defs): boolean {
  return namesReachedBy([defs[name] as SchemaNode], defs).has(name);
}

/** The objects a draw's Input reaches whose proposed def is not recursive, so the proposed version can write them inline. */
function inlinableIn(draw: GraftDraw): readonly string[] {
  const baseline = draw.baseline.endpoints[graftedIdentity]?.input.body as ObjectNode;
  const proposedDefs = draw.proposed.defs;
  return [...namesReachedBy([baseline], draw.baseline.defs)].filter(
    (name) => proposedDefs[name]?.type === 'object' && !isRecursive(name, proposedDefs),
  );
}

/** The fields of an object node, none for any other. */
function fieldsOf(node: SchemaNode | undefined): Readonly<Record<string, unknown>> {
  return node?.type === 'object' ? node.fields : {};
}

/** Whether a `ref` to the def is left in the nodes, the def's own body apart. */
function isNamedIn(name: string, body: SchemaNode, defs: Defs): boolean {
  const others = Object.entries(defs).filter(([held]) => held !== name);
  const nodes = nodesIn([body, ...others.map(([, def]) => def)]);
  return nodes.some((node: Draft) => node.type === 'ref' && node.name === name);
}

/**
 * A `doubledGraftDrawOf` draw whose proposed version writes one of the objects its Input reaches
 * inline, at every use the graft enters, instead of naming the def: a Baseline `ref` meets a node
 * written in place, once under each Baseline def that pairs with the proposed def holding it.
 */
export function inlinedGraftDrawOf(seed: number): GraftDraw {
  const draw = doubledGraftDrawOf(seed);
  const next = seededNext(seed * 6007 + 41);
  const chosen = inlinableIn(draw);
  const name = chosen[Math.floor(next() * chosen.length)];
  if (name === undefined) {
    return draw;
  }
  const proposed = structuredClone(draw.proposed);
  const body = proposed.endpoints[graftedIdentity]?.input.body as ObjectNode;
  const def = proposed.defs[name] as SchemaNode;
  for (const root of [body, ...Object.values(proposed.defs)]) {
    inlinedUsesIn(root, name, def);
  }
  const defs: Record<string, SchemaNode> = { ...proposed.defs };
  if (!isNamedIn(name, body, defs)) {
    Reflect.deleteProperty(defs, name);
  }
  const lostField =
    Object.keys(fieldsOf(draw.baseline.defs[name])).length > Object.keys(fieldsOf(def)).length;
  const kinds = [`inlined: ${name}`, ...(lostField ? ['inlined: lost a field'] : [])];
  return {
    ...draw,
    proposed: aVersionOf(body, defs),
    kinds: new Set([...draw.kinds, ...kinds]),
  };
}
