import type { EnumNode, ObjectNode, SchemaNode, TupleNode } from '@cf-loom/contract/internal';
import { definedOf, type JsonSchema } from './keywords.ts';
import { componentRefOf, defComponentNameOf } from './refs.ts';
import { numberSchemaOf, stringSchemaOf } from './scalars.ts';

/** The JSON Schema of a Snapshot node, with its annotations; a recursive def is a `$ref` to its component. */
export function jsonSchemaOf(node: SchemaNode): JsonSchema {
  const shape = shapeOf(node);
  const nullable = node.nullable === true ? nullableOf(shape, node) : shape;
  return { ...nullable, ...definedOf({ description: node.description, examples: node.examples }) };
}

/** A schema that also admits `null`: in its `type` where that alone constrains it, else beside it in an `anyOf`. */
function nullableOf(shape: JsonSchema, node: SchemaNode): JsonSchema {
  const { type } = shape;
  return typeof type === 'string' && hasOnlyItsType(node)
    ? { ...shape, type: [type, 'null'] }
    : { anyOf: [shape, { type: 'null' }] };
}

/** Whether a node's keywords constrain only values of its own `type`, so `null` can join the type. */
function hasOnlyItsType(node: SchemaNode): boolean {
  switch (node.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
      return true;
    case 'literal':
    case 'enum':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
      return false;
  }
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
      return { type: typeof node.value, const: node.value };
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
      return componentRefOf(defComponentNameOf(node.name));
  }
}

/** A closed enum is typed by its values' JSON types, so a parameter's text can be coerced to one. */
function enumSchemaOf({ values, open }: EnumNode): JsonSchema {
  if (open) {
    return { anyOf: [{ enum: values }, { type: 'string' }] };
  }
  const types = [...new Set(values.map((value) => typeof value))];
  return { type: types.length === 1 ? types[0] : types, enum: values };
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
