import type { Path, SchemaNode } from './nodes.ts';

/** A node inside another, with the steps of the path that lead to it. */
export type Child = { readonly steps: Path; readonly node: SchemaNode };

/** A node and where it sits. */
export type LocatedNode = { readonly at: Path; readonly node: SchemaNode };

/** A node and every node inside it, each where it sits; a `ref` is not entered. */
export function nodesWithin(node: SchemaNode, at: Path): readonly LocatedNode[] {
  const inside = childrenOf(node).flatMap(({ steps, node: child }) =>
    nodesWithin(child, [...at, ...steps]),
  );
  return [{ at, node }, ...inside];
}

/** The nodes directly inside a node, each with the steps the walker's paths take to it. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the children of each node type
export function childrenOf(node: SchemaNode): readonly Child[] {
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
