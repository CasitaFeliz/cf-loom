import type { SchemaNode } from '@casitafeliz/loom-contract/internal';
import { keyOf, stringLiteralOf } from '../source-text/index.ts';
import { defTypeNameOf } from './def-names.ts';
import type { SchemaMode } from './needs.ts';

type NodeOf<Type extends SchemaNode['type']> = Extract<SchemaNode, { readonly type: Type }>;

/**
 * The TypeScript type of what a generated schema returns, written out only for a recursive def,
 * whose `z.lazy` needs it; it agrees with zod's output type of the same node in the same mode.
 */
export function typeTextOf(node: SchemaNode, mode: SchemaMode): string {
  const shape = shapeTypeOf(node, mode);
  return node.nullable === true ? `(${shape} | null)` : shape;
}

function shapeTypeOf(node: SchemaNode, mode: SchemaMode): string {
  switch (node.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'literal':
      return valueTypeOf(node.value);
    case 'enum':
      return enumTypeOf(node, mode);
    case 'object':
      return objectTypeOf(node, mode);
    case 'record':
      return `Record<${typeTextOf(node.key, mode)}, ${typeTextOf(node.value, mode)}>`;
    case 'array':
      return `Array<${typeTextOf(node.items, mode)}>`;
    case 'tuple':
      return tupleTypeOf(node, mode);
    case 'union':
      return `(${node.options.map((option) => typeTextOf(option, mode)).join(' | ')})`;
    case 'tagged':
      return taggedTypeOf(node, mode);
    case 'allOf':
      return `(${node.items.map((item) => typeTextOf(item, mode)).join(' & ')})`;
    case 'json':
      return 'z.core.util.JSONType';
    case 'ref':
      return defTypeNameOf(node.name, mode);
  }
}

function enumTypeOf(node: NodeOf<'enum'>, mode: SchemaMode): string {
  const values = node.values.map(valueTypeOf);
  const unknownCase = node.open && mode === 'reader' ? ['{ unknown: string }'] : [];
  return `(${[...values, ...unknownCase].join(' | ')})`;
}

function objectTypeOf(node: NodeOf<'object'>, mode: SchemaMode): string {
  const fields = Object.entries(node.fields).map(([name, field]) => {
    const optional = field.required ? '' : '?';
    return `${keyOf(name)}${optional}: ${typeTextOf(field.schema, mode)}`;
  });
  return fields.length === 0 ? '{}' : `{ ${fields.join('; ')} }`;
}

function tupleTypeOf(node: NodeOf<'tuple'>, mode: SchemaMode): string {
  const items = node.items.map((item) => typeTextOf(item, mode));
  const rest = node.rest === undefined ? [] : [`...Array<${typeTextOf(node.rest, mode)}>`];
  return `[${[...items, ...rest].join(', ')}]`;
}

/** A discriminated union's variants; an Open Union's reader adds its Unknown case. */
function taggedTypeOf(node: NodeOf<'tagged'>, mode: SchemaMode): string {
  const variants = Object.values(node.variants).map((variant) => typeTextOf(variant, mode));
  if (!node.open || mode === 'declared') {
    return `(${variants.join(' | ')})`;
  }
  const key = keyOf(node.discriminator);
  const raw = `{ ${key}: string; [key: string]: unknown }`;
  const unknownCase = `{ ${key}: { unknown: string }; raw: ${raw} }`;
  return `(${[...variants, unknownCase].join(' | ')})`;
}

function valueTypeOf(value: string | number | boolean): string {
  return typeof value === 'string' ? stringLiteralOf(value) : String(value);
}
