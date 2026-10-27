import type { RefNode, SchemaNode } from './nodes.ts';
import {
  fieldStep,
  indexStep,
  itemsStep,
  keyStep,
  optionStep,
  restStep,
  type Step,
  valueStep,
  variantStep,
} from './steps.ts';
import type { Defs } from './walk.ts';

/** A node inside another, with the steps that lead to it. */
export type Child = { readonly steps: readonly Step[]; readonly node: SchemaNode };

/** A node and the steps from the node the search began at. */
export type NodeWithin = { readonly at: readonly Step[]; readonly node: SchemaNode };

/** A node and every node inside it, each with its steps from the node; a `ref` is not entered. */
export function nodesWithin(node: SchemaNode, at: readonly Step[] = []): readonly NodeWithin[] {
  const inside = childrenOf(node).flatMap(({ steps, node: child }) =>
    nodesWithin(child, [...at, ...steps]),
  );
  return [{ at, node }, ...inside];
}

/**
 * Every node within the given nodes and within each def they reach through `ref`s, directly or
 * through other defs; a def is added once.
 */
export function nodesReachedFrom(nodes: readonly SchemaNode[], defs: Defs): readonly SchemaNode[] {
  const entered = new Set<string>();
  function enter(name: string): readonly SchemaNode[] {
    const def = defs[name];
    if (def === undefined || entered.has(name)) {
      return [];
    }
    entered.add(name);
    return reachedFrom(def);
  }
  function reachedFrom(node: SchemaNode): readonly SchemaNode[] {
    const within = nodesWithin(node).map((inner) => inner.node);
    const names = within.filter(isRef);
    return [...within, ...names.flatMap((ref) => enter(ref.name))];
  }
  return nodes.flatMap(reachedFrom);
}

/**
 * The def names the nodes reference through `ref`s, directly or through the defs those name, each
 * once; a name with no def is included, so a caller can tell it apart.
 */
export function reachedDefsOf(nodes: readonly SchemaNode[], defs: Defs): readonly string[] {
  const refs = nodesReachedFrom(nodes, defs).filter(isRef);
  return [...new Set(refs.map(({ name }) => name))];
}

/** The defs the nodes reach through `ref`s, directly or through other defs, keyed and ordered as in `defs`. */
export function defsReachedOf(nodes: readonly SchemaNode[], defs: Defs): Defs {
  const reached = new Set(reachedDefsOf(nodes, defs));
  return Object.fromEntries(Object.entries(defs).filter(([name]) => reached.has(name)));
}

/**
 * Whether a def leads back to itself through `ref`s, `union` options and `allOf` items alone,
 * with no other node between, which zod's parse never ends on; a `ref` to a name with no def
 * leads nowhere.
 */
export function leadsBackWithNoNode(
  name: string,
  def: SchemaNode,
  defs: ReadonlyMap<string, SchemaNode>,
): boolean {
  const entered = new Set<string>();
  const pending = [def];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'ref') {
      if (node.name === name) {
        return true;
      }
      if (entered.has(node.name)) {
        continue;
      }
      entered.add(node.name);
    }
    for (const next of nodelessStepsFrom(node, defs)) {
      pending.push(next);
    }
  }
  return false;
}

/** The nodes a path with no node between steps to from a node: a `ref`'s def, options or items. */
function nodelessStepsFrom(
  node: SchemaNode,
  defs: ReadonlyMap<string, SchemaNode>,
): readonly SchemaNode[] {
  switch (node.type) {
    case 'ref': {
      const named = defs.get(node.name);
      return named === undefined ? [] : [named];
    }
    case 'union':
      return node.options;
    case 'allOf':
      return node.items;
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
    case 'tagged':
    case 'json':
      return [];
  }
}

function isRef(node: SchemaNode): node is RefNode {
  return node.type === 'ref';
}

/** The nodes directly inside a node, each with the steps to it. */
export function childrenOf(node: SchemaNode): readonly Child[] {
  switch (node.type) {
    case 'object':
      return Object.entries(node.fields).map(([key, field]) => ({
        steps: [fieldStep(key)],
        node: field.schema,
      }));
    case 'record':
      return [
        { steps: [keyStep], node: node.key },
        { steps: [valueStep], node: node.value },
      ];
    case 'array':
      return [{ steps: [itemsStep], node: node.items }];
    case 'tuple':
      return [
        ...node.items.map(indexed),
        ...(node.rest === undefined ? [] : [{ steps: [restStep], node: node.rest }]),
      ];
    case 'union':
      return node.options.map((option, index) => ({ steps: [optionStep(index)], node: option }));
    case 'tagged':
      return Object.entries(node.variants).map(([key, variant]) => ({
        steps: [variantStep(node.discriminator, key)],
        node: variant,
      }));
    case 'allOf':
      return node.items.map(indexed);
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
    case 'json':
    case 'ref':
      return [];
  }
}

function indexed(node: SchemaNode, index: number): Child {
  return { steps: [indexStep(index)], node };
}
