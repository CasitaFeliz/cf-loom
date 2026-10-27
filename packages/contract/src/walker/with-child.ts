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
import type { Step } from './steps.ts';

/**
 * A node with the child at one step replaced: the inverse of `childrenOf` for one child. A step
 * the node has no child at, or a child its place cannot hold, is a bug of the caller.
 */
export function withChild(node: SchemaNode, step: Step, child: SchemaNode): SchemaNode {
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
export function withField(node: SchemaNode, name: string, field: Field): SchemaNode {
  if (node.type !== 'object') {
    throw new Error(`A ${node.type} has no fields: a bug.`);
  }
  return { ...node, fields: { ...node.fields, [name]: field } };
}
