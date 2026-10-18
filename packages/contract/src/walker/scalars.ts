import type * as core from 'zod/v4/core';
import { enumOf } from './choices.ts';
import type { JsonPrimitive, Path } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { allWalked, type Walked, walked } from './walked.ts';

/**
 * A `literal` of one JSON value, or an `enum` of several, since a literal of several values is a
 * union of literals; `null`, `undefined` and bigints have no JSON value of their own.
 */
export function walkLiteral(def: core.$ZodLiteralDef<core.util.Literal>, at: Path): Walked {
  const values = allWalked(def.values.map((value) => jsonValueOf(value, at)));
  if (values.kind === 'not-allowed') {
    return values;
  }
  const [only, ...others] = values.value;
  if (only !== undefined && others.length === 0) {
    return walked({ type: 'literal', value: only });
  }
  return walked(enumOf(values.value));
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
    resolvedLazy(element) === union &&
    resolvedLazy(recordDef?.valueType) === union
  );
}

function jsonValueOf(value: core.util.Literal, at: Path): Walked<JsonPrimitive> {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return notAllowed(at, refused.nonFinite);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return walked(value);
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

function resolvedLazy(schema: core.$ZodType | undefined): core.$ZodType | undefined {
  if (schema?._zod.def.type !== 'lazy') {
    return schema;
  }
  return resolvedLazy((schema as core.$ZodLazy)._zod.innerType);
}
