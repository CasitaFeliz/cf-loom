import type * as core from 'zod/v4/core';
import { prototypeNames } from '../declarations/index.ts';
import { byCanonicalJson, canonicalJson } from './canonical-json.ts';
import type { Field, ObjectNode, Path, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedObjectNameField } from './not-allowed.ts';
import {
  allWalked,
  failed,
  failuresOf,
  type LocatedSchema,
  type Outline,
  type Walked,
  type Walker,
  walked,
} from './walked.ts';

/** The key zod drops when it parses, since assigning it sets the prototype instead. */
const protoKey = '__proto__';

const inheritedKeys: ReadonlySet<string> = new Set(prototypeNames);

/** An object: a Contract declares no strict object, and a catchall is refused. */
export function walkObject(def: core.$ZodObjectDef, at: Path, walker: Walker): Walked {
  const catchall = catchallRefusalOf(def);
  const refusals = catchall === undefined ? [] : [notAllowed(at, catchall)];
  const fieldEntries = Object.entries(def.shape).map(([key, schema]) => {
    const field = { at: [...at, 'fields', key], schema };
    const refusal = fieldNameRefusalOf(key);
    return refusal === undefined
      ? walkedEntry(key, walker.field(schema, field.at))
      : refusedNameFailure(refusal, field, walker);
  });
  const fields = allWalked(fieldEntries);
  if (refusals.length > 0 || fields.kind === 'not-allowed') {
    return failed(failuresOf([...refusals, fields]), { type: 'object' });
  }
  return walked({ type: 'object', fields: Object.fromEntries(fields.value) });
}

/** Why zod cannot read a field of this name, or undefined when it can. */
function fieldNameRefusalOf(key: string): Refused | undefined {
  if (key === protoKey) {
    return refused.protoField;
  }
  return inheritedKeys.has(key) ? refusedObjectNameField(key) : undefined;
}

/** A field zod cannot read by its name, refused beside what lies inside its schema. */
function refusedNameFailure(
  refusal: Refused,
  { at, schema }: LocatedSchema,
  walker: Walker,
): Walked<never> {
  return failed(failuresOf([notAllowed(at, refusal), walker.field(schema, at)]));
}

/**
 * A `record` for a string key, partial or not; a record keyed by an enum or literal is a strict
 * object, which a Contract never declares.
 */
export function walkRecord(def: core.$ZodRecordDef, at: Path, walker: Walker): Walked {
  const key = walker.schema(def.keyType, [...at, 'key']);
  const value = walker.schema(def.valueType, [...at, 'value']);
  const record: Outline = { type: 'record' };
  if (def.mode === 'loose') {
    return failed(failuresOf([notAllowed(at, refused.looseRecord), key, value]), record);
  }
  if (key.kind === 'not-allowed') {
    return failed(failuresOf([key, value]), record);
  }
  const recordKey = recordKeyOf(key.value);
  if (recordKey.kind === 'refused') {
    return failed(failuresOf([notAllowed(at, recordKey.refusal), value]), record);
  }
  if (value.kind === 'not-allowed') {
    return failed(value.failures, record);
  }
  return walked({ type: 'record', key: recordKey.node, value: value.value });
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
    return failed(items.failures, { type: 'allOf' });
  }
  const [left, right] = items.value;
  if (left?.type === 'object' && right?.type === 'object') {
    return mergedObjects(left, right, at);
  }
  return walked({ type: 'allOf', items: [...items.value].sort(byCanonicalJson) });
}

/** What a catchall declares, which a Contract never does: a strict, loose or other catchall. */
function catchallRefusalOf(def: core.$ZodObjectDef): Refused | undefined {
  const catchall = def.catchall?._zod.def.type;
  switch (catchall) {
    case undefined:
      return undefined;
    case 'never':
      return refused.strictObject;
    case 'unknown':
      return refused.looseObject;
    default:
      return refused.catchall;
  }
}

/** A walked key that can key a `record`, or why it cannot: only a string, not nullable, can. */
type RecordKey =
  | { readonly kind: 'string'; readonly node: StringNode }
  | { readonly kind: 'refused'; readonly refusal: Refused };

function recordKeyOf(key: SchemaNode): RecordKey {
  if (key.nullable === true) {
    return { kind: 'refused', refusal: refused.nullableRecordKey };
  }
  if (key.type === 'string') {
    return { kind: 'string', node: key };
  }
  if (key.type !== 'enum') {
    return { kind: 'refused', refusal: refused.recordKey };
  }
  return { kind: 'refused', refusal: key.open ? refused.openRecordKey : refused.keyedRecord };
}

function walkedEntry(key: string, field: Walked<Field>): Walked<[string, Field]> {
  return field.kind === 'walked' ? walked([key, field.value]) : field;
}

function mergedObjects(left: ObjectNode, right: ObjectNode, at: Path): Walked {
  const shared = Object.keys(left.fields).filter((key) => Object.hasOwn(right.fields, key));
  const differs = shared.some(
    (key) => canonicalJson(left.fields[key]) !== canonicalJson(right.fields[key]),
  );
  if (differs) {
    return notAllowed(at, refused.differingIntersection, { type: 'object' });
  }
  const fields = { ...left.fields, ...right.fields };
  const nullable = left.nullable === true && right.nullable === true;
  return walked({ type: 'object', fields, ...(nullable && { nullable }) });
}
