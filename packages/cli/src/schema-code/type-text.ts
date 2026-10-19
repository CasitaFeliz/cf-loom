import type {
  EnumNode,
  ObjectNode,
  SchemaNode,
  TupleNode,
} from '@casitafeliz/loom-contract/internal';
import { keyOf, literalOf } from '../source-text/index.ts';
import { defTypeNameOf } from './def-names.ts';
import { addDefUse, type Needs, noNeeds, type SchemaMode, type Writing } from './needs.ts';

/**
 * The TypeScript type of what a generated schema returns, written out only for a recursive def,
 * whose `z.lazy` needs it; it agrees with zod's output type of the same node in the same mode.
 */
export function typeTextOf(node: SchemaNode, mode: SchemaMode, needs: Needs = noNeeds()): string {
  const writing = { mode, needs };
  const shape = shapeTypeOf(node, writing);
  return node.nullable === true ? `(${shape} | null)` : shape;
}

function typeOf(node: SchemaNode, writing: Writing): string {
  return typeTextOf(node, writing.mode, writing.needs);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the type of each node type
function shapeTypeOf(node: SchemaNode, writing: Writing): string {
  const { mode } = writing;
  switch (node.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'literal':
      return literalOf(node.value);
    case 'enum':
      return enumTypeOf(node, mode);
    case 'object':
      return objectTypeOf(node, writing);
    case 'record':
      return `Record<${typeOf(node.key, writing)}, ${typeOf(node.value, writing)}>`;
    case 'array':
      return `Array<${typeOf(node.items, writing)}>`;
    case 'tuple':
      return tupleTypeOf(node, writing);
    case 'union':
      return `(${node.options.map((option) => typeOf(option, writing)).join(' | ')})`;
    case 'tagged':
      return `(${Object.values(node.variants)
        .map((variant) => typeOf(variant, writing))
        .join(' | ')})`;
    case 'allOf':
      return `(${node.items.map((item) => typeOf(item, writing)).join(' & ')})`;
    case 'json':
      return 'z.core.util.JSONType';
    case 'ref': {
      addDefUse(writing.needs.defTypes, { id: node.name, mode });
      return defTypeNameOf(node.name, mode);
    }
  }
}

function enumTypeOf(node: EnumNode, mode: SchemaMode): string {
  const values = node.values.map(literalOf);
  const unknownCase = node.open && mode === 'reader' ? ['{ unknown: string }'] : [];
  return `(${[...values, ...unknownCase].join(' | ')})`;
}

function objectTypeOf(node: ObjectNode, writing: Writing): string {
  const fields = Object.entries(node.fields).map(([name, field]) => {
    const optional = field.required ? '' : '?';
    return `${keyOf(name)}${optional}: ${typeOf(field.schema, writing)}`;
  });
  return fields.length === 0 ? '{}' : `{ ${fields.join('; ')} }`;
}

function tupleTypeOf(node: TupleNode, writing: Writing): string {
  const items = node.items.map((item) => typeOf(item, writing));
  const rest = node.rest === undefined ? [] : [`...Array<${typeOf(node.rest, writing)}>`];
  return `[${[...items, ...rest].join(', ')}]`;
}
