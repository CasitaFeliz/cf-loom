import type { SchemaNode } from './nodes.ts';
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

/** The def names a node's own `ref`s name, each once, inside the node alone, with no def entered. */
export function refsWrittenIn(node: SchemaNode): readonly string[] {
  const names = new Set<string>();
  const pending = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === 'ref') {
      names.add(next.name);
    }
    for (const child of childrenOf(next)) {
      pending.push(child.node);
    }
  }
  return [...names];
}

function indexed(node: SchemaNode, index: number): Child {
  return { steps: [indexStep(index)], node };
}
