import type {
  AllOfNode,
  Field,
  ObjectNode,
  RecordNode,
  RefNode,
  SchemaNode,
  StringNode,
  TupleNode,
} from './nodes.ts';
import { byShape, shapeKey } from './shapes.ts';
import type { Step } from './steps.ts';

/** A change to a node: a child replaced at its step, a field put under its name, or a `ref` renamed. */
export type NodeEdit =
  | { readonly kind: 'child'; readonly step: Step; readonly node: SchemaNode }
  | { readonly kind: 'field'; readonly name: string; readonly field: Field }
  | { readonly kind: 'renamed'; readonly name: string; readonly nullable: boolean };

/**
 * A node as a Snapshot holds it: the edits applied in order, each `child` at the step the node had
 * before any edit, then an `allOf`'s items in shape order, each shape once, the first kept with its
 * annotations. Its children are taken as already held, since every builder builds from the leaves
 * up. An edit the node has no place for is a bug of the caller.
 */
export function heldNodeOf(node: SchemaNode, edits: readonly NodeEdit[]): SchemaNode {
  let edited = node;
  for (const edit of edits) {
    edited = editedBy(edited, edit);
  }
  return edited.type === 'allOf' ? { ...edited, items: inShapeOrder(edited.items) } : edited;
}

function editedBy(node: SchemaNode, edit: NodeEdit): SchemaNode {
  switch (edit.kind) {
    case 'child':
      return withChild(node, edit.step, edit.node);
    case 'field':
      return withField(node, edit.name, edit.field);
    case 'renamed':
      return refNamed(node, edit);
  }
}

/**
 * An intersection's items as a Snapshot holds them: each shape once, the first declared kept with
 * its annotations, in shape order, so no annotation decides an item's place or whether two are one.
 */
function inShapeOrder(items: readonly SchemaNode[]): readonly SchemaNode[] {
  const firstByShape = new Map<string, SchemaNode>();
  for (const item of items) {
    const key = shapeKey(item);
    if (!firstByShape.has(key)) {
      firstByShape.set(key, item);
    }
  }
  return [...firstByShape.values()].sort(byShape);
}

/**
 * A node with the child at one step replaced: the inverse of `childrenOf` for one child. A step
 * the node has no child at, or a child its place cannot hold, is a bug of the caller.
 */
function withChild(node: SchemaNode, step: Step, child: SchemaNode): SchemaNode {
  const replaced = replacedAt(node, step, child);
  if (replaced === undefined) {
    throw new Error(`A ${node.type} has no place for a ${child.type} at ${step.kind}: a bug.`);
  }
  return replaced;
}

function replacedAt(node: SchemaNode, step: Step, child: SchemaNode): SchemaNode | undefined {
  switch (node.type) {
    case 'object':
      return step.kind === 'field' ? withFieldSchema(node, step.name, child) : undefined;
    case 'array':
      return step.kind === 'items' ? { ...node, items: child } : undefined;
    case 'record':
      return recordWith(node, step, child);
    case 'tuple':
      return step.kind === 'rest' ? { ...node, rest: child } : itemsWith(node, step, child);
    case 'allOf':
      return itemsWith(node, step, child);
    case 'union':
      return step.kind === 'option'
        ? { ...node, options: replacedIn(node.options, step.index, child) }
        : undefined;
    case 'tagged':
      return step.kind === 'variant' && isVariant(child)
        ? { ...node, variants: { ...node.variants, [step.value]: child } }
        : undefined;
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
    case 'json':
    case 'ref':
      return undefined;
  }
}

function recordWith(node: RecordNode, step: Step, child: SchemaNode): SchemaNode | undefined {
  if (step.kind === 'key') {
    return isString(child) ? { ...node, key: child } : undefined;
  }
  return step.kind === 'value' ? { ...node, value: child } : undefined;
}

function itemsWith(
  node: TupleNode | AllOfNode,
  step: Step,
  child: SchemaNode,
): SchemaNode | undefined {
  return step.kind === 'index'
    ? { ...node, items: replacedIn(node.items, step.index, child) }
    : undefined;
}

function replacedIn(nodes: readonly SchemaNode[], index: number, child: SchemaNode): SchemaNode[] {
  return nodes.map((node, at) => (at === index ? child : node));
}

/** An object with the schema of a field it holds replaced, its `required` kept. */
function withFieldSchema(
  node: ObjectNode,
  name: string,
  schema: SchemaNode,
): SchemaNode | undefined {
  const field = node.fields[name];
  return field === undefined
    ? undefined
    : { ...node, fields: { ...node.fields, [name]: { ...field, schema } } };
}

function isString(node: SchemaNode): node is StringNode {
  return node.type === 'string';
}

function isVariant(node: SchemaNode): node is ObjectNode | RefNode {
  return node.type === 'object' || node.type === 'ref';
}

/** A node with a field put at a name of its, whether it held one there or not: an object's only. */
function withField(node: SchemaNode, name: string, field: Field): SchemaNode {
  if (node.type !== 'object') {
    throw new Error(`A ${node.type} has no fields: a bug.`);
  }
  return { ...node, fields: { ...node.fields, [name]: field } };
}

/** A `ref` renamed, with its own annotations, nullable when the chain of defs it followed is. */
function refNamed(
  node: SchemaNode,
  chain: { readonly name: string; readonly nullable: boolean },
): SchemaNode {
  if (node.type !== 'ref') {
    throw new Error(`A ${node.type} is no \`ref\` to rename: a bug.`);
  }
  const { nullable: _nullable, ...annotations } = node;
  const named = { ...annotations, name: chain.name } as const;
  return chain.nullable ? { ...named, nullable: true } : named;
}

/** A node as a def holds it: plain, since every `ref` to a def carries its own `nullable`. */
export function withoutNullable(node: SchemaNode): SchemaNode {
  const { nullable: _nullable, ...rest } = node;
  return rest;
}
