import { byCodePoint, canonicalJson } from './canonical-json.ts';
import { type Field, neutralAnnotations, type SchemaNode } from './nodes.ts';

/**
 * A node's shape alone: what two declarations of one header, query param or code must agree on.
 * `description`, `examples` and `origin` are Neutral, so they are left out at every depth; the
 * items of an `allOf` and a union's options keep the order the node holds them in.
 */
export function shapeOf(node: SchemaNode): SchemaNode {
  const own = withoutNeutral(node);
  switch (own.type) {
    case 'object':
      return { ...own, fields: fieldShapes(own.fields) };
    case 'record':
      return { ...own, key: withoutNeutral(own.key), value: shapeOf(own.value) };
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
    case 'enum':
    case 'json':
    case 'ref':
      return own;
  }
}

/** A node without its Neutral annotations; what remains is its shape and its children. */
function withoutNeutral<Node extends SchemaNode>(node: Node): Node {
  const neutral: readonly string[] = neutralAnnotations;
  const kept = Object.entries(node).filter(([key]) => !neutral.includes(key));
  return Object.fromEntries(kept) as Node;
}

/** The canonical JSON of a node's shape, so two shapes compare as text. */
export function shapeKey(node: SchemaNode): string {
  return canonicalJson(shapeOf(node));
}

/** Orders nodes by their shapes, as a Snapshot orders an `allOf`'s items. */
export function byShape(left: SchemaNode, right: SchemaNode): number {
  return byCodePoint(shapeKey(left), shapeKey(right));
}

/**
 * An intersection's items as a Snapshot holds them: each shape once, the first declared kept with
 * its annotations, in shape order, so no annotation decides an item's place or whether two are one.
 */
export function inShapeOrder(items: readonly SchemaNode[]): readonly SchemaNode[] {
  const firstByShape = new Map<string, SchemaNode>();
  for (const item of items) {
    const key = shapeKey(item);
    if (!firstByShape.has(key)) {
      firstByShape.set(key, item);
    }
  }
  const byKey = [...firstByShape.entries()].sort(([left], [right]) => byCodePoint(left, right));
  return byKey.map(([, item]) => item);
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
