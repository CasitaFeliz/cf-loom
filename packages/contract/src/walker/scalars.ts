import type * as core from 'zod/v4/core';
import { byCanonicalJson } from './canonical-json.ts';
import type { JsonPrimitive, Path, SchemaNode } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { allWalked, type Walked, walked } from './walked.ts';

type Coercible = core.$ZodStringDef | core.$ZodNumberDef | core.$ZodBooleanDef;

/** A string, before its checks: `z.coerce.string()` converts, so it fails. */
export function walkString(def: core.$ZodStringDef, at: Path): Walked {
  return uncoerced(def, at, { type: 'string' });
}

/** A number, before its checks: `z.coerce.number()` converts, so it fails. */
export function walkNumber(def: core.$ZodNumberDef, at: Path): Walked {
  return uncoerced(def, at, { type: 'number' });
}

/** A boolean: `z.coerce.boolean()` converts, so it fails. */
export function walkBoolean(def: core.$ZodBooleanDef, at: Path): Walked {
  return uncoerced(def, at, { type: 'boolean' });
}

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
  const sorted = [...values.value].sort(byCanonicalJson);
  return walked({ type: 'enum', values: sorted, open: false });
}

/**
 * Whether a union is the one `z.json()` builds: any JSON value, whose arrays and records hold
 * the union itself again.
 */
export function isJsonUnion(union: core.$ZodType, def: core.$ZodUnionDef): boolean {
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

function uncoerced(def: Coercible, at: Path, node: SchemaNode): Walked {
  if (def.coerce) {
    return notAllowed(at, refused.coerce);
  }
  return walked(node);
}

function jsonValueOf(value: core.util.Literal, at: Path): Walked<JsonPrimitive> {
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
