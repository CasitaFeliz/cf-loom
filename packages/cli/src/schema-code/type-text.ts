import type { SchemaNode } from '@casitafeliz/loom-contract/internal';
import { keyOf, literalOf } from '../source-text/index.ts';
import { defTypeNameOf } from './def-names.ts';
import { addDefUse, type Needs, noNeeds, type SchemaMode } from './needs.ts';
import type { NodeOf } from './nodes.ts';

/**
 * The TypeScript type of what a generated schema returns, written out only for a recursive def,
 * whose `z.lazy` needs it; it agrees with zod's output type of the same node in the same mode.
 */
export function typeTextOf(node: SchemaNode, mode: SchemaMode, needs: Needs = noNeeds()): string {
  const typing = { mode, needs };
  const shape = shapeTypeOf(node, typing);
  return node.nullable === true ? `(${shape} | null)` : shape;
}

/** The mode a type is written in, and where the def types it names are recorded. */
type Typing = { readonly mode: SchemaMode; readonly needs: Needs };

function typeOf(node: SchemaNode, typing: Typing): string {
  return typeTextOf(node, typing.mode, typing.needs);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the type of each node type
function shapeTypeOf(node: SchemaNode, typing: Typing): string {
  const { mode } = typing;
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
      return objectTypeOf(node, typing);
    case 'record':
      return `Record<${typeOf(node.key, typing)}, ${typeOf(node.value, typing)}>`;
    case 'array':
      return `Array<${typeOf(node.items, typing)}>`;
    case 'tuple':
      return tupleTypeOf(node, typing);
    case 'union':
      return `(${node.options.map((option) => typeOf(option, typing)).join(' | ')})`;
    case 'tagged':
      return taggedTypeOf(node, typing);
    case 'allOf':
      return `(${node.items.map((item) => typeOf(item, typing)).join(' & ')})`;
    case 'json':
      return 'z.core.util.JSONType';
    case 'ref': {
      addDefUse(typing.needs.defTypes, { id: node.name, mode });
      return defTypeNameOf(node.name, mode);
    }
  }
}

function enumTypeOf(node: NodeOf<'enum'>, mode: SchemaMode): string {
  const values = node.values.map(literalOf);
  const unknownCase = node.open && mode === 'reader' ? ['{ unknown: string }'] : [];
  return `(${[...values, ...unknownCase].join(' | ')})`;
}

function objectTypeOf(node: NodeOf<'object'>, typing: Typing): string {
  const fields = Object.entries(node.fields).map(([name, field]) => {
    const optional = field.required ? '' : '?';
    return `${keyOf(name)}${optional}: ${typeOf(field.schema, typing)}`;
  });
  return fields.length === 0 ? '{}' : `{ ${fields.join('; ')} }`;
}

function tupleTypeOf(node: NodeOf<'tuple'>, typing: Typing): string {
  const items = node.items.map((item) => typeOf(item, typing));
  const rest = node.rest === undefined ? [] : [`...Array<${typeOf(node.rest, typing)}>`];
  return `[${[...items, ...rest].join(', ')}]`;
}

/** A discriminated union's variants; an Open Union's reader adds its Unknown case. */
function taggedTypeOf(node: NodeOf<'tagged'>, typing: Typing): string {
  const variants = variantsTypeOf(node, typing.mode, typing.needs);
  if (!node.open || typing.mode === 'declared') {
    return variants;
  }
  const key = keyOf(node.discriminator);
  const raw = `{ ${key}: string; [key: string]: unknown }`;
  return `(${variants} | { ${key}: { unknown: string }; raw: ${raw} })`;
}

/** The type of a discriminated union's declared variants. */
function variantsTypeOf(node: NodeOf<'tagged'>, mode: SchemaMode, needs: Needs): string {
  const variants = Object.entries(node.variants).map(([, variant]) =>
    typeTextOf(variant, mode, needs),
  );
  return `(${variants.join(' | ')})`;
}
