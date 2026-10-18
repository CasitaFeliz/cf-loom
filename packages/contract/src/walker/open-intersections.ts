import type { NotAllowed, Path, SchemaNode } from './nodes.ts';
import { refused } from './not-allowed.ts';

/** The recursive defs a node's `ref`s name. */
type Defs = Readonly<Record<string, SchemaNode>>;

/** A node inside another, with the steps of the path that lead to it. */
type Child = { readonly steps: Path; readonly node: SchemaNode };

/**
 * Every `allOf` in a node that reaches an Open Enum or an Open Union, at any depth and through
 * `ref`s: a reader of an intersection merges what each item read, and an Unknown case and the
 * value it came from never merge.
 */
export function openIntersectionsOf(node: SchemaNode, at: Path, defs: Defs): readonly NotAllowed[] {
  return intersectionsIn(node, at, { defs, seen: new Set() });
}

/** What one search shares: the defs, and the ones already searched, so a cycle ends. */
type Search = { readonly defs: Defs; readonly seen: ReadonlySet<string> };

function intersectionsIn(node: SchemaNode, at: Path, search: Search): readonly NotAllowed[] {
  if (node.type === 'allOf' && reachesOpen(node, { defs: search.defs, seen: new Set() })) {
    return [{ kind: 'not-allowed', at, ...refused.openIntersection }];
  }
  if (node.type === 'ref') {
    return insideRef(node.name, at, search);
  }
  return childrenOf(node).flatMap(({ steps, node: child }) =>
    intersectionsIn(child, [...at, ...steps], search),
  );
}

function insideRef(name: string, at: Path, search: Search): readonly NotAllowed[] {
  const def = search.defs[name];
  if (def === undefined || search.seen.has(name)) {
    return [];
  }
  return intersectionsIn(def, at, { defs: search.defs, seen: new Set([...search.seen, name]) });
}

function reachesOpen(node: SchemaNode, search: Search): boolean {
  if ((node.type === 'enum' || node.type === 'tagged') && node.open) {
    return true;
  }
  if (node.type !== 'ref') {
    return childrenOf(node).some(({ node: child }) => reachesOpen(child, search));
  }
  const def = search.defs[node.name];
  if (def === undefined || search.seen.has(node.name)) {
    return false;
  }
  return reachesOpen(def, { defs: search.defs, seen: new Set([...search.seen, node.name]) });
}

/** The nodes directly inside a node, each with the steps the walker's paths take to it. */
function childrenOf(node: SchemaNode): readonly Child[] {
  switch (node.type) {
    case 'object':
      return Object.entries(node.fields).map(([key, field]) => ({
        steps: ['fields', key],
        node: field.schema,
      }));
    case 'record':
      return [
        { steps: ['key'], node: node.key },
        { steps: ['value'], node: node.value },
      ];
    case 'array':
      return [{ steps: ['items'], node: node.items }];
    case 'tuple':
      return [
        ...indexed('items', node.items),
        ...(node.rest === undefined ? [] : [{ steps: ['rest'], node: node.rest }]),
      ];
    case 'union':
      return indexed('options', node.options);
    case 'tagged':
      return Object.entries(node.variants).map(([key, variant]) => ({
        steps: ['variants', key],
        node: variant,
      }));
    case 'allOf':
      return indexed('items', node.items);
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'json':
    case 'ref':
      return [];
  }
}

function indexed(key: string, nodes: readonly SchemaNode[]): readonly Child[] {
  return nodes.map((node, index) => ({ steps: [key, index], node }));
}
