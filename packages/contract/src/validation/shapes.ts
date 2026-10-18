import { canonicalJson } from '../walker/canonical-json.ts';
import type { Field, SchemaNode } from '../walker/nodes.ts';

/**
 * A node's shape alone: what two declarations of one header, query param or code must agree on.
 * `description`, `examples` and `origin` are Neutral, so they are left out at every depth.
 */
export function shapeOf(node: SchemaNode): SchemaNode {
  const { description: _description, examples: _examples, origin: _origin, ...own } = node;
  switch (own.type) {
    case 'object':
      return { ...own, fields: fieldShapes(own.fields) };
    case 'record':
      return { ...own, key: shapeOf(own.key), value: shapeOf(own.value) };
    case 'array':
      return { ...own, items: shapeOf(own.items) };
    case 'tuple':
      return own.rest === undefined
        ? { ...own, items: own.items.map(shapeOf) }
        : { ...own, items: own.items.map(shapeOf), rest: shapeOf(own.rest) };
    case 'union':
      return { ...own, options: own.options.map(shapeOf) };
    case 'allOf':
      return { ...own, items: own.items.map(shapeOf) };
    case 'tagged':
      return { ...own, variants: variantShapes(own.variants) };
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'json':
    case 'ref':
      return own;
  }
}

/** The canonical JSON of a node's shape, so two shapes compare as text. */
export function shapeKey(node: SchemaNode): string {
  return canonicalJson(shapeOf(node));
}

function fieldShapes(fields: Readonly<Record<string, Field>>): Readonly<Record<string, Field>> {
  const shaped = Object.entries(fields).map(([name, field]) => [
    name,
    { required: field.required, schema: shapeOf(field.schema) },
  ]);
  return Object.fromEntries(shaped);
}

function variantShapes<Variant extends SchemaNode>(
  variants: Readonly<Record<string, Variant>>,
): Readonly<Record<string, Variant>> {
  const shaped = Object.entries(variants).map(([key, variant]) => [key, shapeOf(variant)]);
  return Object.fromEntries(shaped);
}
