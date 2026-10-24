import type { EnumNode, ObjectNode, SchemaNode, TupleNode } from '@cf-loom/contract/internal';
import { defTypeNameOf } from '../schema-code/index.ts';
import { definedOf, type JsonSchema } from './keywords.ts';
import { componentRefOf } from './refs.ts';
import { numberSchemaOf, stringSchemaOf } from './scalars.ts';

/** The JSON Schema of a Snapshot node, with its annotations; a recursive def is a `$ref` to its component. */
export function jsonSchemaOf(node: SchemaNode): JsonSchema {
  const shape = shapeOf(node);
  const nullable = node.nullable === true ? nullableOf(shape) : shape;
  return { ...nullable, ...definedOf({ description: node.description, examples: node.examples }) };
}

/** A schema that also admits `null`: in its `type` when it has one, else beside it in an `anyOf`. */
function nullableOf(shape: JsonSchema): JsonSchema {
  const { type } = shape;
  return typeof type === 'string'
    ? { ...shape, type: [type, 'null'] }
    : { anyOf: [shape, { type: 'null' }] };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the JSON Schema of each node type
function shapeOf(node: SchemaNode): JsonSchema {
  switch (node.type) {
    case 'string':
      return stringSchemaOf(node);
    case 'number':
      return numberSchemaOf(node);
    case 'boolean':
      return { type: 'boolean' };
    case 'literal':
      return { const: node.value };
    case 'enum':
      return enumSchemaOf(node);
    case 'object':
      return objectSchemaOf(node);
    case 'record':
      return {
        type: 'object',
        propertyNames: jsonSchemaOf(node.key),
        additionalProperties: jsonSchemaOf(node.value),
      };
    case 'array': {
      const items = jsonSchemaOf(node.items);
      return definedOf({ type: 'array', items, minItems: node.min, maxItems: node.max });
    }
    case 'tuple':
      return tupleSchemaOf(node);
    case 'union':
      return { anyOf: node.options.map(jsonSchemaOf) };
    case 'tagged':
      return { oneOf: Object.values(node.variants).map(jsonSchemaOf) };
    case 'allOf':
      return { allOf: node.items.map(jsonSchemaOf) };
    case 'json':
      return {};
    case 'ref':
      return componentRefOf(defTypeNameOf(node.name, 'declared'));
  }
}

function enumSchemaOf({ values, open }: EnumNode): JsonSchema {
  return open ? { anyOf: [{ enum: values }, { type: 'string' }] } : { enum: values };
}

function objectSchemaOf({ fields, mode }: ObjectNode): JsonSchema {
  const entries = Object.entries(fields);
  const required = entries.filter(([, field]) => field.required).map(([name]) => name);
  return definedOf({
    type: 'object',
    properties: Object.fromEntries(
      entries.map(([name, field]) => [name, jsonSchemaOf(field.schema)]),
    ),
    required: required.length === 0 ? undefined : required,
    additionalProperties: mode === 'strict' ? false : undefined,
  });
}

/** A tuple closes after its last item, since zod refuses a missing item and an extra one alike. */
function tupleSchemaOf({ items, rest }: TupleNode): JsonSchema {
  return {
    type: 'array',
    prefixItems: items.map(jsonSchemaOf),
    minItems: items.length,
    items: rest === undefined ? false : jsonSchemaOf(rest),
  };
}
