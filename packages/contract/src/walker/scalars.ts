import type * as core from 'zod/v4/core';
import { isJsonPrimitive } from './canonical-json.ts';
import { enumOf } from './choices.ts';
import { innerOfLazy } from './lazy.ts';
import type { Place } from './location.ts';
import type { JsonPrimitive } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { allWalked, failed, type Walked, walked } from './walked.ts';

/**
 * A closed `enum` of the literal's JSON values; `null`, `undefined` and bigints have no JSON value
 * of their own.
 */
export function walkLiteral(def: core.$ZodLiteralDef<core.util.Literal>, at: Place): Walked {
  const values = allWalked(def.values.map((value) => jsonValueOf(value, at)));
  if (values.kind === 'not-allowed') {
    return failed(values.failures, { type: 'enum' });
  }
  return enumOf(values.value, at);
}

/**
 * Whether a union is the one `z.json()` builds, read by mirroring zod's own construction: the
 * union of string, number, boolean, null, and an array and a string-keyed record of itself.
 */
export function isJsonUnion(union: core.$ZodUnion): boolean {
  const def = union._zod.def;
  const kinds = def.options.map((option) => option._zod.def.type);
  if (kinds.join() !== 'string,number,boolean,null,array,record') {
    return false;
  }
  const [string, number, , , array, record] = def.options.map((option) => option._zod.def);
  const element = (array as core.$ZodArrayDef | undefined)?.element;
  const recordDef = record as core.$ZodRecordDef | undefined;
  return (
    isPlain(string) &&
    isPlain(number) &&
    isPlain(recordDef?.keyType._zod.def) &&
    element !== undefined &&
    innerOfLazy(element) === union &&
    recordDef !== undefined &&
    innerOfLazy(recordDef.valueType) === union
  );
}

function jsonValueOf(value: core.util.Literal, at: Place): Walked<JsonPrimitive> {
  if (isJsonPrimitive(value)) {
    return walked(value);
  }
  if (typeof value === 'number') {
    return notAllowed(at, refused.nonFinite);
  }
  if (typeof value === 'bigint') {
    return notAllowed(at, refused.literalBigint);
  }
  if (value === undefined) {
    return notAllowed(at, refused.literalUndefined);
  }
  return notAllowed(at, refused.literalNull);
}

function isPlain(def: core.$ZodTypeDef | undefined): boolean {
  const unchecked = def?.checks === undefined || def.checks.length === 0;
  return unchecked && def !== undefined && !('check' in def) && !('coerce' in def && def.coerce);
}
