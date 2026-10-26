import type { Field, SchemaNode } from './nodes.ts';
import type { Defs, WalkedLocation, WalkedSchemas } from './walk.ts';

/**
 * The walk with no def nullable: `.nullable()` belongs to a use, so a def whose id sat on its
 * `.nullable()` loses it and every `ref` to it carries it, one spelling for one shape.
 */
export function withNullableOnUses(walk: WalkedSchemas): WalkedSchemas {
  const nullableDefs = new Set(
    Object.entries(walk.defs)
      .filter(([, def]) => def.nullable === true)
      .map(([name]) => name),
  );
  if (nullableDefs.size === 0) {
    return walk;
  }
  const defs: Defs = Object.fromEntries(
    Object.entries(walk.defs).map(([name, def]) => [
      name,
      onUses(nullableDefs.has(name) ? withoutNullable(def) : def, nullableDefs),
    ]),
  );
  const located = walk.located.map((location): WalkedLocation => {
    if (location.walked.kind !== 'walked') {
      return location;
    }
    return {
      at: location.at,
      walked: { kind: 'walked', value: onUses(location.walked.value, nullableDefs) },
    };
  });
  return { located, defs };
}

function withoutNullable(node: SchemaNode): SchemaNode {
  const { nullable: _nullable, ...rest } = node;
  return rest as SchemaNode;
}

/** The node with `nullable` on every `ref` to a def that carried it, at any depth. */
function onUses(node: SchemaNode, names: ReadonlySet<string>): SchemaNode {
  const inner = (child: SchemaNode) => onUses(child, names);
  switch (node.type) {
    case 'ref':
      return names.has(node.name) ? { ...node, nullable: true } : node;
    case 'object':
      return { ...node, fields: fieldsOnUses(node.fields, inner) };
    case 'record':
      return { ...node, value: inner(node.value) };
    case 'array':
      return { ...node, items: inner(node.items) };
    case 'tuple':
      return node.rest === undefined
        ? { ...node, items: node.items.map(inner) }
        : { ...node, items: node.items.map(inner), rest: inner(node.rest) };
    case 'union':
      return { ...node, options: node.options.map(inner) };
    case 'allOf':
      return { ...node, items: node.items.map(inner) };
    case 'tagged':
      return {
        ...node,
        variants: Object.fromEntries(
          Object.entries(node.variants).map(([key, variant]) => [key, onUses(variant, names)]),
        ) as typeof node.variants,
      };
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
    case 'json':
      return node;
  }
}

function fieldsOnUses(
  fields: Readonly<Record<string, Field>>,
  inner: (node: SchemaNode) => SchemaNode,
): Readonly<Record<string, Field>> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      { ...field, schema: inner(field.schema) },
    ]),
  );
}
