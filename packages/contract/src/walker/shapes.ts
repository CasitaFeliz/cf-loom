import { byCanonicalJson, canonicalJson } from './canonical-json.ts';
import { type Field, neutralAnnotations, type SchemaNode } from './nodes.ts';

/**
 * A node's shape alone: what two declarations of one header, query param or code must agree on.
 * `description`, `examples` and `origin` are Neutral, so they are left out at every depth, and
 * the items of an `allOf` are in the order of their shapes, which a Neutral annotation cannot
 * change; a union's options stay in declared order, which is part of its shape.
 */
export function shapeOf(node: SchemaNode): SchemaNode {
  const own = withoutNeutral(node);
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
      return { ...own, items: inShapeOrder(own.items) };
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

/** A node without its Neutral annotations; what remains is its shape and its children. */
function withoutNeutral(node: SchemaNode): SchemaNode {
  const neutral: readonly string[] = neutralAnnotations;
  const kept = Object.entries(node).filter(([key]) => !neutral.includes(key));
  return Object.fromEntries(kept) as SchemaNode;
}

/** The canonical JSON of a node's shape, so two shapes compare as text. */
export function shapeKey(node: SchemaNode): string {
  return canonicalJson(shapeOf(node));
}

function inShapeOrder(nodes: readonly SchemaNode[]): readonly SchemaNode[] {
  return nodes.map(shapeOf).sort(byCanonicalJson);
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
