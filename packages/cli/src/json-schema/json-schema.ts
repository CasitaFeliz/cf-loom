import type { EnumNode, ObjectNode, SchemaNode, TupleNode } from '@cf-loom/contract/internal';
import { definedOf, type JsonSchema, type JsonSchemaDialect } from './keywords.ts';
import { componentRefOf, defComponentNameOf } from './refs.ts';
import { numberSchemaOf, stringSchemaOf } from './scalars.ts';

/** The JSON Schema of a Snapshot node in a dialect, with its annotations; a recursive def is a `$ref` to its component. */
export function jsonSchemaOf(node: SchemaNode, dialect: JsonSchemaDialect): JsonSchema {
  const shape = shapeOf(node, dialect);
  const nullable = node.nullable === true ? nullableOf(shape, node) : shape;
  const annotations = definedOf({ description: node.description, examples: node.examples });
  return annotatedOf(nullable, annotations, dialect);
}

/**
 * A schema with its annotations beside it; in draft-07 a bare `$ref` goes in an `allOf` first, since
 * a tool ignores every keyword beside a `$ref` there.
 */
function annotatedOf(
  schema: JsonSchema,
  annotations: JsonSchema,
  dialect: JsonSchemaDialect,
): JsonSchema {
  switch (dialect) {
    case '2020-12':
      return { ...schema, ...annotations };
    case 'draft-07':
      return '$ref' in schema && Object.keys(annotations).length > 0
        ? { allOf: [schema], ...annotations }
        : { ...schema, ...annotations };
  }
}

/** A schema that also admits `null`: in its `type` where that alone constrains it, else beside it in an `anyOf`. */
function nullableOf(shape: JsonSchema, node: SchemaNode): JsonSchema {
  return hasOnlyItsType(node)
    ? { ...shape, type: [shape['type'], 'null'] }
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
function shapeOf(node: SchemaNode, dialect: JsonSchemaDialect): JsonSchema {
  const schemaOf = (child: SchemaNode): JsonSchema => jsonSchemaOf(child, dialect);
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
      return objectSchemaOf(node, dialect);
    case 'record':
      return {
        type: 'object',
        propertyNames: schemaOf(node.key),
        additionalProperties: schemaOf(node.value),
      };
    case 'array': {
      const items = schemaOf(node.items);
      return definedOf({ type: 'array', items, minItems: node.min, maxItems: node.max });
    }
    case 'tuple':
      return tupleSchemaOf(node, dialect);
    case 'union':
      return { anyOf: node.options.map(schemaOf) };
    case 'tagged':
      return { oneOf: Object.values(node.variants).map(schemaOf) };
    case 'allOf':
      return { allOf: node.items.map(schemaOf) };
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

function objectSchemaOf({ fields, mode }: ObjectNode, dialect: JsonSchemaDialect): JsonSchema {
  const entries = Object.entries(fields);
  const required = entries.filter(([, field]) => field.required).map(([name]) => name);
  return definedOf({
    type: 'object',
    properties: Object.fromEntries(
      entries.map(([name, field]) => [name, jsonSchemaOf(field.schema, dialect)]),
    ),
    required: required.length === 0 ? undefined : required,
    additionalProperties: mode === 'strict' ? false : undefined,
  });
}

/**
 * A tuple closes after its last item, since zod refuses a missing item and an extra one alike; with
 * no item it is the array of its rest, since neither dialect takes an empty list of items.
 */
function tupleSchemaOf({ items, rest }: TupleNode, dialect: JsonSchemaDialect): JsonSchema {
  const further = rest === undefined ? false : jsonSchemaOf(rest, dialect);
  if (items.length === 0) {
    return { type: 'array', minItems: 0, items: further };
  }
  const listed = items.map((item) => jsonSchemaOf(item, dialect));
  switch (dialect) {
    case '2020-12':
      return { type: 'array', prefixItems: listed, minItems: items.length, items: further };
    case 'draft-07':
      return { type: 'array', items: listed, minItems: items.length, additionalItems: further };
  }
}
