import { unbrokenLineOf } from '../lines/index.ts';
import type {
  AllOfNode,
  Field,
  ObjectNode,
  RecordNode,
  RefNode,
  SchemaNode,
  StringNode,
  TaggedNode,
  TupleNode,
  UnionNode,
} from './nodes.ts';
import { byShape, shapeKey } from './shapes.ts';
import type { Step } from './steps.ts';

/** A change to a node: a child replaced at its step, a field put under its name, or a `ref` renamed. */
export type NodeEdit =
  | { readonly kind: 'child'; readonly step: Step; readonly node: SchemaNode }
  | { readonly kind: 'field'; readonly name: string; readonly field: Field }
  | { readonly kind: 'renamed'; readonly name: string; readonly nullable: boolean };

type ChildEdit = Extract<NodeEdit, { readonly kind: 'child' }>;

/**
 * A node as a Snapshot holds it: the edits applied in order to one copy of the node, each `child`
 * at the step the node had before any edit, then an `allOf`'s items in shape order, each shape
 * once, the first kept with its annotations. Its children are taken as already held, since every
 * builder builds from the leaves up. An edit the node has no place for is a bug of the caller.
 */
export function heldNodeOf(node: SchemaNode, edits: readonly NodeEdit[]): SchemaNode {
  const edited = edits.length === 0 ? node : editedCopyOf(node, edits);
  return edited.type === 'allOf' ? { ...edited, items: inShapeOrder(edited.items) } : edited;
}

/**
 * The node with every edit applied to one copy of it and of the one container of children it
 * holds, so an edit list costs its length and the container's, not their product.
 */
function editedCopyOf(node: SchemaNode, edits: readonly NodeEdit[]): SchemaNode {
  switch (node.type) {
    case 'object':
      return { ...node, fields: editedFields(node, edits) };
    case 'tagged':
      return { ...node, variants: editedVariants(node, edits) };
    case 'union':
      return { ...node, options: editedList(node, [...node.options], edits) };
    case 'allOf':
      return { ...node, items: editedList(node, [...node.items], edits) };
    case 'tuple':
      return editedTuple(node, edits);
    case 'array':
      return { ...node, items: lastChildAt(node, 'items', edits) ?? node.items };
    case 'record':
      return editedRecord(node, edits);
    case 'ref':
      return editedRef(node, edits);
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
    case 'json':
      throw noPlaceFor(node, edits[0] as NodeEdit);
  }
}

/** What an edit that a node has no place for is: a bug of the caller. */
function noPlaceFor(node: SchemaNode, edit: NodeEdit): Error {
  switch (edit.kind) {
    case 'child':
      return new Error(
        unbrokenLineOf(
          `A ${node.type} has no place for a ${edit.node.type} at ${edit.step.kind}: a bug.`,
        ),
      );
    case 'field':
      return new Error(unbrokenLineOf(`A ${node.type} has no fields: a bug.`));
    case 'renamed':
      return new Error(unbrokenLineOf(`A ${node.type} is no \`ref\` to rename: a bug.`));
  }
}

/** The edit as a child edit at a kind of step, or a bug of the caller. */
function childEditAt(node: SchemaNode, edit: NodeEdit, kind: Step['kind']): ChildEdit {
  if (edit.kind !== 'child' || edit.step.kind !== kind) {
    throw noPlaceFor(node, edit);
  }
  return edit;
}

/** A value put as an own property, whatever the name: `__proto__` is a field like any other. */
function putOwn<Value>(record: Record<string, Value>, name: string, value: Value): void {
  Object.defineProperty(record, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function editedFields(node: ObjectNode, edits: readonly NodeEdit[]): Record<string, Field> {
  const fields: Record<string, Field> = { ...node.fields };
  for (const edit of edits) {
    if (edit.kind === 'field') {
      putOwn(fields, edit.name, edit.field);
      continue;
    }
    const { step, node: schema } = childEditAt(node, edit, 'field');
    const field = step.kind === 'field' && Object.hasOwn(fields, step.name) ? step : undefined;
    if (field === undefined) {
      throw noPlaceFor(node, edit);
    }
    putOwn(fields, field.name, { ...(fields[field.name] as Field), schema });
  }
  return fields;
}

function editedVariants(
  node: TaggedNode,
  edits: readonly NodeEdit[],
): Record<string, ObjectNode | RefNode> {
  const variants: Record<string, ObjectNode | RefNode> = { ...node.variants };
  for (const edit of edits) {
    const { step, node: variant } = childEditAt(node, edit, 'variant');
    if (step.kind !== 'variant' || !isVariant(variant)) {
      throw noPlaceFor(node, edit);
    }
    putOwn(variants, step.value, variant);
  }
  return variants;
}

/** The list with each edit's node put at the index of its step, which the list must hold. */
function editedList(
  node: UnionNode | AllOfNode | TupleNode,
  list: SchemaNode[],
  edits: readonly NodeEdit[],
): SchemaNode[] {
  const kind = node.type === 'union' ? 'option' : 'index';
  for (const edit of edits) {
    const { step, node: item } = childEditAt(node, edit, kind);
    if (step.kind !== kind || step.index >= list.length) {
      throw noPlaceFor(node, edit);
    }
    list[step.index] = item;
  }
  return list;
}

function editedTuple(node: TupleNode, edits: readonly NodeEdit[]): TupleNode {
  const isRest = (edit: NodeEdit) => edit.kind === 'child' && edit.step.kind === 'rest';
  const items = editedList(
    node,
    [...node.items],
    edits.filter((edit) => !isRest(edit)),
  );
  const rest = edits.filter(isRest).at(-1);
  const held = rest === undefined ? node.rest : childEditAt(node, rest, 'rest').node;
  return held === undefined ? { ...node, items } : { ...node, items, rest: held };
}

/** The node the last of the edits puts at a kind of step, none when there are no edits; any other edit is a bug. */
function lastChildAt(
  node: SchemaNode,
  kind: Step['kind'],
  edits: readonly NodeEdit[],
): SchemaNode | undefined {
  return edits.map((edit) => childEditAt(node, edit, kind).node).at(-1);
}

function editedRecord(node: RecordNode, edits: readonly NodeEdit[]): RecordNode {
  let { key, value } = node;
  for (const edit of edits) {
    if (edit.kind === 'child' && edit.step.kind === 'key' && isString(edit.node)) {
      key = edit.node;
    } else if (edit.kind === 'child' && edit.step.kind === 'value') {
      value = edit.node;
    } else {
      throw noPlaceFor(node, edit);
    }
  }
  return { ...node, key, value };
}

function editedRef(node: RefNode, edits: readonly NodeEdit[]): SchemaNode {
  let edited: SchemaNode = node;
  for (const edit of edits) {
    if (edit.kind !== 'renamed') {
      throw noPlaceFor(node, edit);
    }
    edited = refNamed(node, edit);
  }
  return edited;
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

function isString(node: SchemaNode): node is StringNode {
  return node.type === 'string';
}

function isVariant(node: SchemaNode): node is ObjectNode | RefNode {
  return node.type === 'object' || node.type === 'ref';
}

/** A `ref` renamed, with its own annotations, nullable when the chain of defs it followed is. */
function refNamed(
  node: RefNode,
  chain: { readonly name: string; readonly nullable: boolean },
): SchemaNode {
  const { nullable: _nullable, ...annotations } = node;
  const named = { ...annotations, name: chain.name } as const;
  return chain.nullable ? { ...named, nullable: true } : named;
}

/** A node as a def holds it: plain, since every `ref` to a def carries its own `nullable`. */
export function withoutNullable(node: SchemaNode): SchemaNode {
  const { nullable: _nullable, ...rest } = node;
  return rest;
}
