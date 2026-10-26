import type * as core from 'zod/v4/core';
import { prototypeNames } from '../declarations/index.ts';
import { inCanonicalJsonOrder } from './canonical-json.ts';
import { catchallRefusalKeyOf } from './def-types.ts';
import { inside, type Place } from './location.ts';
import type { Field, ObjectNode, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedObjectNameField } from './not-allowed.ts';
import { shapeKey } from './shapes.ts';
import { fieldStep, indexStep, keyStep, valueStep } from './steps.ts';
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
export function walkObject(def: core.$ZodObjectDef, at: Place, walker: Walker): Walked {
  const catchall = catchallRefusalOf(def);
  const refusals = catchall === undefined ? [] : [notAllowed(at, catchall)];
  const fieldEntries = Object.entries(def.shape).map(([key, schema]) => {
    const field = { at: inside(at, fieldStep(key)), schema };
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
export function walkRecord(def: core.$ZodRecordDef, at: Place, walker: Walker): Walked {
  const key = walker.schema(def.keyType, inside(at, keyStep));
  const value = walker.schema(def.valueType, inside(at, valueStep));
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
export function walkIntersection(def: core.$ZodIntersectionDef, at: Place, walker: Walker): Walked {
  const items = allWalked([
    walker.schema(def.left, inside(at, indexStep(0))),
    walker.schema(def.right, inside(at, indexStep(1))),
  ]);
  if (items.kind === 'not-allowed') {
    return failed(items.failures, { type: 'allOf' });
  }
  const [left, right] = items.value;
  if (left?.type === 'object' && right?.type === 'object') {
    return mergedObjects(left, right, at);
  }
  return walked({ type: 'allOf', items: inCanonicalJsonOrder(items.value) });
}

/** What a catchall declares, which a Contract never does, worded as `catchalls` reads its def type. */
function catchallRefusalOf(def: core.$ZodObjectDef): Refused | undefined {
  const catchall = def.catchall?._zod.def.type;
  return catchall === undefined ? undefined : refused[catchallRefusalKeyOf(catchall)];
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

function mergedObjects(left: ObjectNode, right: ObjectNode, at: Place): Walked {
  const shared = Object.keys(left.fields).filter((key) => Object.hasOwn(right.fields, key));
  const differs = shared.some((key) => !isSameField(left.fields[key], right.fields[key]));
  if (differs) {
    return notAllowed(at, refused.differingIntersection, { type: 'object' });
  }
  const fields = { ...right.fields, ...left.fields };
  const nullable = left.nullable === true && right.nullable === true;
  return walked({ type: 'object', fields, ...(nullable && { nullable }) });
}

/** Two declarations of one field agree on whether it is required and on its shape alone. */
function isSameField(left: Field | undefined, right: Field | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.required === right.required && shapeKey(left.schema) === shapeKey(right.schema);
}
