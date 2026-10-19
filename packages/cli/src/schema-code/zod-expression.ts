import type { Field, SchemaNode } from '@casitafeliz/loom-contract/internal';
import { jsonLiteralOf, keyOf, literalOf, stringLiteralOf } from '../source-text/index.ts';
import { defIdentifierOf } from './def-names.ts';
import { formatCallOf, regexCallOf } from './formats.ts';
import { addDefUse, type Needs, type SchemaMode } from './needs.ts';
import type { NodeOf } from './nodes.ts';
import { openEnumReaderOf, openUnionReaderOf } from './open.ts';
import { variantsTypeOf } from './type-text.ts';

/** Where a schema is written: its mode, and what the module writing it must import. */
export type Writing = { readonly mode: SchemaMode; readonly needs: Needs };

/**
 * The zod expression of a Snapshot node in a mode, with its nullability and annotations, so the
 * generated schema walks back to the same node.
 */
export function zodExpressionOf(node: SchemaNode, writing: Writing): string {
  writing.needs.modules.add('zod');
  const shape = shapeOf(node, writing);
  const nullable = node.nullable === true ? `${shape}.nullable()` : shape;
  return `${nullable}${metaOf(node)}`;
}

function shapeOf(node: SchemaNode, writing: Writing): string {
  switch (node.type) {
    case 'string':
      return stringOf(node);
    case 'number':
      return numberOf(node);
    case 'boolean':
      return 'z.boolean()';
    case 'literal':
      return `z.literal(${literalOf(node.value)})`;
    case 'enum':
      return enumOf(node, writing);
    case 'object':
      return objectOf(node, writing);
    case 'record':
      return `z.record(${zodExpressionOf(node.key, writing)}, ${zodExpressionOf(node.value, writing)})`;
    case 'array':
      return `z.array(${zodExpressionOf(node.items, writing)})${boundsOf(node)}`;
    case 'tuple':
      return tupleOf(node, writing);
    case 'union':
      return `z.union([${node.options.map((option) => zodExpressionOf(option, writing)).join(', ')}])`;
    case 'tagged':
      return taggedOf(node, writing);
    case 'allOf':
      return allOfOf(node.items.map((item) => zodExpressionOf(item, writing)));
    case 'json':
      return 'z.json()';
    case 'ref':
      return refOf(node, writing);
  }
}

function stringOf(node: NodeOf<'string'>): string {
  const base =
    node.format === undefined ? 'z.string()' : formatCallOf(node.format, node.formatOptions);
  const regex = node.regex === undefined ? '' : regexCallOf(node.regex);
  return `${base}${regex}${boundsOf(node)}`;
}

function numberOf(node: NodeOf<'number'>): string {
  const base = node.int === true ? 'z.int()' : 'z.number()';
  const checks = [
    node.min === undefined ? '' : `.min(${node.min})`,
    node.exclusiveMin === undefined ? '' : `.gt(${node.exclusiveMin})`,
    node.max === undefined ? '' : `.max(${node.max})`,
    node.exclusiveMax === undefined ? '' : `.lt(${node.exclusiveMax})`,
    node.multipleOf === undefined ? '' : `.multipleOf(${node.multipleOf})`,
  ];
  return `${base}${checks.join('')}`;
}

function boundsOf(node: { readonly min?: number; readonly max?: number }): string {
  const min = node.min === undefined ? '' : `.min(${node.min})`;
  const max = node.max === undefined ? '' : `.max(${node.max})`;
  return `${min}${max}`;
}

/** An enum: an Open Enum's reader has its Unknown case; values that are not all strings are literals. */
function enumOf(node: NodeOf<'enum'>, writing: Writing): string {
  const values = node.values.map(literalOf).join(', ');
  const allStrings = node.values.every((value) => typeof value === 'string');
  if (!node.open) {
    return allStrings ? `z.enum([${values}])` : `z.literal([${values}])`;
  }
  if (writing.mode === 'reader') {
    return openEnumReaderOf(`z.enum([${values}])`);
  }
  writing.needs.modules.add('loom');
  return `loom.openEnum([${values}])`;
}

/** An object: strict only as declared, since readers ignore fields they do not know. */
function objectOf(node: NodeOf<'object'>, writing: Writing): string {
  const fields = Object.entries(node.fields).map(
    ([name, field]) => `${keyOf(name)}: ${fieldOf(field, writing)}`,
  );
  const call =
    node.mode === 'strict' && writing.mode === 'declared' ? 'z.strictObject' : 'z.object';
  return fields.length === 0 ? `${call}({})` : `${call}({ ${fields.join(', ')} })`;
}

/**
 * A field's schema; an annotated reference to a recursive def carries its annotations on the
 * field's wrapper, since `.meta()` on the def itself would clone it without its id.
 */
function fieldOf(field: Field, writing: Writing): string {
  const { schema, required } = field;
  const isAnnotatedRef = schema.type === 'ref' && schema.nullable !== true && metaOf(schema) !== '';
  if (!isAnnotatedRef) {
    const expression = zodExpressionOf(schema, writing);
    return required ? expression : `${expression}.optional()`;
  }
  const reference = zodExpressionOf({ type: 'ref', name: schema.name }, writing);
  return `${reference}${required ? '.nonoptional()' : '.optional()'}${metaOf(schema)}`;
}

function tupleOf(node: NodeOf<'tuple'>, writing: Writing): string {
  const items = node.items.map((item) => zodExpressionOf(item, writing)).join(', ');
  if (node.rest === undefined) {
    return `z.tuple([${items}])`;
  }
  return `z.tuple([${items}], ${zodExpressionOf(node.rest, writing)})`;
}

/** A discriminated union: an Open Union's reader has its Unknown case. */
function taggedOf(node: NodeOf<'tagged'>, writing: Writing): string {
  const declared = declaredUnionOf(node, writing);
  if (!node.open || writing.mode === 'declared') {
    return declared;
  }
  const knownValues = Object.keys(node.variants);
  return openUnionReaderOf(declared, node.discriminator, knownValues);
}

/**
 * The declared variants as zod's discriminated union, or `loom.openUnion` for an Open Union as
 * declared. A recursive variant's def is typed by its discriminator alone, which is what the
 * union reads of it, and the union by its variants' types, which zod cannot infer through it.
 */
function declaredUnionOf(node: NodeOf<'tagged'>, writing: Writing): string {
  const variants = Object.entries(node.variants).map(([value, variant]) =>
    variant.type === 'ref'
      ? recursiveVariantOf(node.discriminator, { value, variant }, writing)
      : zodExpressionOf(variant, writing),
  );
  const isOpenAsDeclared = node.open && writing.mode === 'declared';
  if (isOpenAsDeclared) {
    writing.needs.modules.add('loom');
  }
  const call = isOpenAsDeclared ? 'loom.openUnion' : 'z.discriminatedUnion';
  const union = `${call}(${stringLiteralOf(node.discriminator)}, [${variants.join(', ')}])`;
  const isRecursive = Object.values(node.variants).some((variant) => variant.type === 'ref');
  return isRecursive
    ? `(${union} as z.ZodType<${variantsTypeOf(node, writing.mode, writing.needs)}>)`
    : union;
}

/** A variant that is a recursive def, typed as the object of its discriminator, `value` its canonical JSON. */
function recursiveVariantOf(
  discriminator: string,
  { value, variant }: { readonly value: string; readonly variant: NodeOf<'ref'> },
  writing: Writing,
): string {
  const shape = `{ ${keyOf(discriminator)}: z.ZodLiteral<${value}> }`;
  return `(${zodExpressionOf(variant, writing)} as unknown as z.ZodObject<${shape}>)`;
}

/** An intersection of every item, nested from the left, as zod intersects two at a time. */
function allOfOf(items: readonly string[]): string {
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new Error('An allOf node intersects at least one item');
  }
  let intersection = first;
  for (const item of rest) {
    intersection = `z.intersection(${intersection}, ${item})`;
  }
  return intersection;
}

/** A recursive def by its identifier. */
function refOf(node: NodeOf<'ref'>, writing: Writing): string {
  addDefUse(writing.needs.defs, { id: node.name, mode: writing.mode });
  return defIdentifierOf(node.name, writing.mode);
}

/** The annotations a schema's `.meta()` carries: its description and examples; `origin` is not code's. */
function metaOf(node: SchemaNode): string {
  const meta = {
    ...(node.description !== undefined && { description: node.description }),
    ...(node.examples !== undefined && { examples: node.examples }),
  };
  return Object.keys(meta).length === 0 ? '' : `.meta(${jsonLiteralOf(meta)})`;
}
