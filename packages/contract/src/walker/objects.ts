import type * as core from 'zod/v4/core';
import { byCanonicalJson, canonicalJson } from './canonical-json.ts';
import type { Field, JsonPrimitive, ObjectNode, Path, SchemaNode } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { allWalked, failed, failuresOf, type Walked, type Walker, walked } from './walked.ts';

/** An object, `open` unless it is strict: a catchall lets in keys no field declares. */
export function walkObject(def: core.$ZodObjectDef, at: Path, walker: Walker): Walked {
  const mode = modeOf(def, at);
  const fieldEntries = Object.entries(def.shape).map(([key, schema]) =>
    walkedEntry(key, walker.field(schema, [...at, 'fields', key])),
  );
  const fields = allWalked(fieldEntries);
  if (mode.kind === 'not-allowed' || fields.kind === 'not-allowed') {
    return failed(failuresOf([mode, fields]));
  }
  return walked({ type: 'object', mode: mode.value, fields: Object.fromEntries(fields.value) });
}

/**
 * A `record` for a string key; for an enum or literal key, a `strict` object with a field per
 * key, required unless the record is partial.
 */
export function walkRecord(def: core.$ZodRecordDef, at: Path, walker: Walker): Walked {
  if (def.mode === 'loose') {
    return notAllowed(at, refused.looseRecord);
  }
  const key = walker.schema(def.keyType, [...at, 'key']);
  const value = walker.schema(def.valueType, [...at, 'value']);
  if (key.kind === 'not-allowed' || value.kind === 'not-allowed') {
    return failed(failuresOf([key, value]));
  }
  if (key.value.nullable === true) {
    return notAllowed(at, refused.nullableRecordKey);
  }
  if (key.value.type === 'enum' && key.value.open) {
    return notAllowed(at, refused.openRecordKey);
  }
  if (key.value.type === 'string') {
    return walked({ type: 'record', key: key.value, value: value.value });
  }
  const keys = keysOf(key.value);
  if (keys === undefined) {
    return notAllowed(at, refused.recordKey);
  }
  const field: Field = { required: def.partial !== true, schema: value.value };
  const fields = Object.fromEntries(keys.map((name) => [name, field]));
  return walked({ type: 'object', mode: 'strict', fields });
}

/**
 * One open object for an intersection of open objects whose shared keys agree, which fails
 * otherwise; any other intersection is `allOf`.
 */
export function walkIntersection(def: core.$ZodIntersectionDef, at: Path, walker: Walker): Walked {
  const items = allWalked([
    walker.schema(def.left, [...at, 'items', 0]),
    walker.schema(def.right, [...at, 'items', 1]),
  ]);
  if (items.kind === 'not-allowed') {
    return items;
  }
  const [left, right] = items.value;
  if (left?.type === 'object' && right?.type === 'object') {
    return mergedObjects(left, right, at);
  }
  return walked({ type: 'allOf', items: [...items.value].sort(byCanonicalJson) });
}

function modeOf(def: core.$ZodObjectDef, at: Path): Walked<ObjectNode['mode']> {
  const catchall = def.catchall?._zod.def.type;
  if (catchall === undefined) {
    return walked('open');
  }
  if (catchall === 'never') {
    return walked('strict');
  }
  return notAllowed(at, catchall === 'unknown' ? refused.looseObject : refused.catchall);
}

function walkedEntry(key: string, field: Walked<Field>): Walked<[string, Field]> {
  return field.kind === 'walked' ? walked([key, field.value]) : field;
}

function keysOf(key: SchemaNode): readonly string[] | undefined {
  const values = keyValuesOf(key);
  const keys = values.filter(isString);
  if (keys.length === 0 || keys.length !== values.length) {
    return undefined;
  }
  return keys;
}

function keyValuesOf(key: SchemaNode): readonly JsonPrimitive[] {
  if (key.type === 'literal') {
    return [key.value];
  }
  if (key.type === 'enum') {
    return key.values;
  }
  return [];
}

function isString(value: JsonPrimitive): value is string {
  return typeof value === 'string';
}

function mergedObjects(left: ObjectNode, right: ObjectNode, at: Path): Walked {
  if (left.mode === 'strict' || right.mode === 'strict') {
    return notAllowed(at, refused.strictIntersection);
  }
  const shared = Object.keys(left.fields).filter((key) => Object.hasOwn(right.fields, key));
  const differs = shared.some(
    (key) => canonicalJson(left.fields[key]) !== canonicalJson(right.fields[key]),
  );
  if (differs) {
    return notAllowed(at, refused.differingIntersection);
  }
  const fields = { ...left.fields, ...right.fields };
  const nullable = left.nullable === true && right.nullable === true;
  return walked({ type: 'object', mode: 'open', fields, ...(nullable && { nullable }) });
}
