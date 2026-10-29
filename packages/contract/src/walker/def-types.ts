import * as core from 'zod/v4/core';
import type { refused } from './not-allowed.ts';

/** A zod def, as the union of every def zod declares, so a switch over its type is closed. */
export type Def = core.$ZodTypes['_zod']['def'];

/** The name zod gives each kind of def. */
export type DefType = Def['type'];

/** The def of one def type. */
export type DefOfType<Type extends DefType> = Extract<Def, { readonly type: Type }>;

/** A Not allowed entry, by its key in the list. */
export type RefusalKey = keyof typeof refused;

/**
 * What the walk does with a def type: walks the schemas under these keys of its def, walks the
 * fields under this key, or refuses it as this Not allowed entry.
 */
export type Treatment<Type extends DefType> =
  | { readonly walks: readonly (keyof DefOfType<Type>)[] }
  | { readonly fields: keyof DefOfType<Type> }
  | { readonly refuses: RefusalKey };

/**
 * Every zod def type and what the walk does with it, written once: the walk at runtime and the
 * type rule of every declaration read the same row. A pipe is refused as `pipeRefusals` splits
 * it, and an object's catchall as `catchalls` names it.
 */
export const defTypes = {
  string: { walks: [] },
  number: { walks: [] },
  boolean: { walks: [] },
  literal: { walks: [] },
  enum: { walks: [] },
  object: { fields: 'shape' },
  record: { walks: ['keyType', 'valueType'] },
  array: { walks: ['element'] },
  tuple: { walks: ['items', 'rest'] },
  union: { walks: ['options'] },
  intersection: { walks: ['left', 'right'] },
  lazy: { walks: ['getter'] },
  nullable: { walks: ['innerType'] },
  optional: { refuses: 'optional' },
  nonoptional: { refuses: 'nonoptional' },
  default: { refuses: 'default' },
  prefault: { refuses: 'prefault' },
  catch: { refuses: 'catch' },
  readonly: { refuses: 'readonly' },
  transform: { refuses: 'transform' },
  pipe: { refuses: 'pipe' },
  custom: { refuses: 'custom' },
  date: { refuses: 'date' },
  null: { refuses: 'null' },
  undefined: { refuses: 'undefined' },
  any: { refuses: 'any' },
  unknown: { refuses: 'unknown' },
  bigint: { refuses: 'bigint' },
  symbol: { refuses: 'symbol' },
  void: { refuses: 'void' },
  never: { refuses: 'never' },
  nan: { refuses: 'nan' },
  map: { refuses: 'map' },
  set: { refuses: 'set' },
  file: { refuses: 'file' },
  promise: { refuses: 'promise' },
  function: { refuses: 'function' },
  success: { refuses: 'success' },
  // biome-ignore lint/style/useNamingConvention: zod's name of the def type
  template_literal: { refuses: 'templateLiteral' },
} as const satisfies { readonly [Type in DefType]: Treatment<Type> };

/** The table's type, for a rule or a test that enumerates its rows. */
export type DefTypes = typeof defTypes;

/** The def types the walk refuses by their own name. */
export type RefusedDefType = {
  [Type in DefType]: (typeof defTypes)[Type] extends { readonly refuses: RefusalKey }
    ? Type
    : never;
}[DefType];

/** The def types the walk reads a node from, walking the schemas they hold. */
export type WalkedDefType = Exclude<DefType, RefusedDefType>;

/** A def the walk reads a node from. */
export type WalkedDef = DefOfType<WalkedDefType>;

/** A def the walk refuses by its own name. */
export type RefusedDef = DefOfType<RefusedDefType>;

const refusedDefTypes: ReadonlySet<string> = new Set(
  Object.entries(defTypes)
    .filter(([, treatment]) => 'refuses' in treatment)
    .map(([type]) => type),
);

/**
 * Whether a value is a zod 4 schema, by zod's own `instanceof`: it reads the traits in `_zod`, which
 * zod, `zod/mini` and any copy of either set, and a zod/v3 schema or a hand-built `_zod` object
 * lacks, so the walk never reads `_zod.def` of anything else.
 */
export function isSchema(value: unknown): value is core.$ZodType {
  return value instanceof core.$ZodType;
}

/** Whether a def is one the walk reads a node from, rather than refuses by name. */
export function isWalkedDef(def: Def): def is WalkedDef {
  return !refusedDefTypes.has(def.type);
}

/** Whether a def type is one this walker was written for; zod may add one later. */
export function isKnownDefType(type: string): type is DefType {
  return Object.hasOwn(defTypes, type);
}

/** What a rule on a pipe's shape states, and what it is refused as. */
export type PipeRule = {
  readonly reversed?: true;
  readonly in?: DefType;
  readonly out?: DefType;
  readonly refuses: RefusalKey;
};

/**
 * The shape of one pipe: whether it has a reverse transform, and the def types of its ends, none
 * for an end that is no zod 4 schema.
 */
export type PipeShape = {
  readonly reversed: boolean;
  readonly in: string | undefined;
  readonly out: string | undefined;
};

/**
 * How a pipe is refused, by its shape: the first rule whose every stated part the pipe has, else
 * as `defTypes` refuses a pipe; a codec is a pipe with a reverse transform.
 */
export const pipeRefusals = [
  { reversed: true, in: 'string', out: 'boolean', refuses: 'stringbool' },
  { reversed: true, refuses: 'codec' },
  { in: 'transform', refuses: 'preprocess' },
  { out: 'transform', refuses: 'transform' },
] as const satisfies readonly PipeRule[];

/** The rules' type, for a rule or a test that enumerates them. */
export type PipeRefusals = typeof pipeRefusals;

/** The Not allowed entry a pipe of this shape is refused as. */
export function pipeRefusalKeyOf(shape: PipeShape): RefusalKey {
  const rule = pipeRefusals.find((candidate) => matchesPipe(candidate, shape));
  return rule === undefined ? defTypes.pipe.refuses : rule.refuses;
}

function matchesPipe(rule: PipeRule, shape: PipeShape): boolean {
  const reversedMatches = rule.reversed === undefined || rule.reversed === shape.reversed;
  const inMatches = rule.in === undefined || rule.in === shape.in;
  const outMatches = rule.out === undefined || rule.out === shape.out;
  return reversedMatches && inMatches && outMatches;
}

/**
 * How an object's catchall is refused, by the catchall's def type: a strict object is a catchall
 * of `z.never()`, a loose one of `z.unknown()`; any other is `.catchall()`.
 */
export const catchalls = {
  never: 'strictObject',
  unknown: 'looseObject',
} as const satisfies Partial<Record<DefType, RefusalKey>>;

/** The table's type, for a rule or a test that enumerates its rows. */
export type Catchalls = typeof catchalls;

/** The Not allowed entry a catchall of this def type is refused as. */
export function catchallRefusalKeyOf(type: string): RefusalKey {
  return isCatchallWorded(type) ? catchalls[type] : 'catchall';
}

function isCatchallWorded(type: string): type is keyof typeof catchalls {
  return Object.hasOwn(catchalls, type);
}
