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
import type { Step } from './steps.ts';

/** A change to a node: a child replaced at its step, a field put under its name, or a `ref` renamed. */
export type NodeEdit =
  | { readonly kind: 'child'; readonly step: Step; readonly node: SchemaNode }
  | { readonly kind: 'field'; readonly name: string; readonly field: Field }
  | { readonly kind: 'renamed'; readonly name: string; readonly nullable: boolean };

type ChildEdit = Extract<NodeEdit, { readonly kind: 'child' }>;

/**
 * The node with every edit applied to one copy of it and of the one container of children it
 * holds, so an edit list costs its length and the container's, not their product.
 */
export function editedCopyOf(node: SchemaNode, edits: readonly NodeEdit[]): SchemaNode {
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

/** An edit that puts a node at a step of one kind. */
type ChildEditAt<Kind extends Step['kind']> = ChildEdit & {
  readonly step: Extract<Step, { readonly kind: Kind }>;
};

/** The edit as a child edit, or a bug of the caller. */
function childEditOf(node: SchemaNode, edit: NodeEdit): ChildEdit {
  if (edit.kind !== 'child') {
    throw noPlaceFor(node, edit);
  }
  return edit;
}

/** The edit as a child edit at a kind of step, or a bug of the caller. */
function childEditAt<Kind extends Step['kind']>(
  node: SchemaNode,
  edit: NodeEdit,
  kind: Kind,
): ChildEditAt<Kind> {
  const child = childEditOf(node, edit);
  if (child.step.kind !== kind) {
    throw noPlaceFor(node, edit);
  }
  return child as ChildEditAt<Kind>;
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
    if (!Object.hasOwn(fields, step.name)) {
      throw noPlaceFor(node, edit);
    }
    putOwn(fields, step.name, { ...(fields[step.name] as Field), schema });
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
    if (!Object.hasOwn(variants, step.value) || !isVariant(variant)) {
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
    if (step.index >= list.length) {
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
    const { step, node: child } = childEditOf(node, edit);
    if (step.kind === 'key' && isString(child)) {
      key = child;
    } else if (step.kind === 'value') {
      value = child;
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
