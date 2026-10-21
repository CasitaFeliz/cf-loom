import type { Path, RefNode, SchemaNode } from './nodes.ts';
import type { Defs } from './walk.ts';

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

/**
 * Every node within the located nodes and within each def they reach through `ref`s, directly or
 * through other defs; a def is added once, at `['defs', <id>]`.
 */
export function nodesReachedFrom(
  located: readonly LocatedNode[],
  defs: Defs,
): readonly LocatedNode[] {
  const entered = new Set<string>();
  function enter(name: string): readonly LocatedNode[] {
    const def = defs[name];
    if (def === undefined || entered.has(name)) {
      return [];
    }
    entered.add(name);
    return reachedFrom({ at: ['defs', name], node: def });
  }
  function reachedFrom({ at, node }: LocatedNode): readonly LocatedNode[] {
    const within = nodesWithin(node, at);
    const names = within.map((inner) => inner.node).filter(isRef);
    return [...within, ...names.flatMap((ref) => enter(ref.name))];
  }
  return located.flatMap(reachedFrom);
}

/**
 * The def names the nodes reference through `ref`s, directly or through the defs those name, each
 * once; a name with no def is included, so a caller can tell it apart.
 */
export function reachedDefsOf(nodes: readonly SchemaNode[], defs: Defs): readonly string[] {
  const located = nodes.map((node): LocatedNode => ({ at: [], node }));
  const refs = nodesReachedFrom(located, defs)
    .map(({ node }) => node)
    .filter(isRef);
  return [...new Set(refs.map(({ name }) => name))];
}

/**
 * The defs a def's `ref`s lead through when they come back to the def itself, its own name first,
 * which no node stands behind; `undefined` when they reach another node or a name with no def.
 */
export function aliasCycleOf(
  name: string,
  def: SchemaNode,
  defs: Defs,
): readonly string[] | undefined {
  const chain = [name];
  let node: SchemaNode | undefined = def;
  while (node?.type === 'ref') {
    if (node.name === name) {
      return chain;
    }
    if (chain.includes(node.name)) {
      return undefined;
    }
    chain.push(node.name);
    node = Object.hasOwn(defs, node.name) ? defs[node.name] : undefined;
  }
  return undefined;
}

function isRef(node: SchemaNode): node is RefNode {
  return node.type === 'ref';
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
