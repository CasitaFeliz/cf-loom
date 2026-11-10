import type * as core from 'zod/v4/core';
import { isJsonPrimitive } from './canonical-json.ts';
import { enumOf } from './choices.ts';
import { type Def, type DefOfType, defOf } from './def-types.ts';
import { innerOfLazy } from './lazy.ts';
import type { JsonPrimitive } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { allWalked, failed, type Reached, type Walked, walked } from './walked.ts';

/**
 * A closed `enum` of the literal's JSON values; `null`, `undefined` and bigints have no JSON value
 * of their own.
 */
export function walkLiteral(def: core.$ZodLiteralDef<core.util.Literal>, at: Reached): Walked {
  const values = allWalked(def.values.map((value) => jsonValueOf(value, at)));
  if (values.kind === 'not-allowed') {
    return failed(values.tree);
  }
  return enumOf(values.value, at);
}

/**
 * Whether a union is the one `z.json()` builds, read by mirroring zod's own construction: the
 * union of string, number, boolean, null, and an array and a string-keyed record of itself.
 */
export function isJsonUnion(union: core.$ZodType, def: DefOfType<'union'>): boolean {
  const options = def.options.map(defOf);
  if (options.map((option) => option?.type).join() !== 'string,number,boolean,null,array,record') {
    return false;
  }
  const [string, number, , , array, record] = options;
  if (array?.type !== 'array' || record?.type !== 'record') {
    return false;
  }
  return (
    isPlain(string) &&
    isPlain(number) &&
    isPlain(defOf(record.keyType)) &&
    innerOfLazy(array.element) === union &&
    innerOfLazy(record.valueType) === union
  );
}

function jsonValueOf(value: core.util.Literal, at: Reached): Walked<JsonPrimitive> {
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

function isPlain(def: Def | undefined): boolean {
  const unchecked = def?.checks === undefined || def.checks.length === 0;
  return unchecked && def !== undefined && !('check' in def) && !('coerce' in def && def.coerce);
}
