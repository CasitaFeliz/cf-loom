import type * as core from 'zod/v4/core';
import { type Refused, refused, refusedName } from './not-allowed.ts';

/** A check as zod's def writes it; `describe` and `meta` are how `zod/mini` sets metadata. */
export type CheckDef =
  | (core.$ZodChecks | core.$ZodStringFormatChecks)['_zod']['def']
  | { readonly check: 'custom'; readonly type?: 'custom' }
  | { readonly check: 'describe' | 'meta' };

/** A def as zod built it, read key by key. */
export type BuiltDef = Readonly<Record<string, unknown>> & {
  readonly format?: unknown;
  readonly pattern?: unknown;
  readonly when?: unknown;
};

/**
 * A check as declared, and the same check built again with other options by the very zod copy
 * that built it, so it is compared with that copy's own defaults; nothing when zod refuses them.
 */
export type DeclaredCheck = {
  readonly def: CheckDef;
  readonly rebuilt: (def: object) => BuiltDef | undefined;
};

type CheckInstance = {
  readonly _zod: {
    readonly def: unknown;
    readonly constr?: new (def: object) => { readonly _zod: { readonly def: unknown } };
  };
};

/** The checks a schema declares, its own first: a format schema such as `z.email()` is a check. */
export function checksOf(schema: core.$ZodType): readonly DeclaredCheck[] {
  const own: CheckInstance[] = 'check' in schema._zod.def ? [schema] : [];
  const listed: readonly CheckInstance[] = schema._zod.def.checks ?? [];
  return [...own, ...listed].map(declaredCheckOf).filter(isConstraintCheck);
}

/**
 * Whether a check runs only when a condition of the author's holds: a `when` other than the one
 * zod gives that check itself.
 */
export function isConditional(check: DeclaredCheck): boolean {
  const when = 'when' in check.def ? check.def.when : undefined;
  if (when === undefined) {
    return false;
  }
  const { when: _declared, ...unconditional } = check.def as BuiltDef;
  return check.rebuilt(unconditional)?.when !== when;
}

/** The name a check is refused by, on a node that does not take it. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the name of each check zod has
export function refusedCheck(check: CheckDef): Refused {
  switch (check.check) {
    case 'custom':
      return check.type === 'custom' ? refused.refine : refused.customCheck;
    case 'overwrite':
      return refused.mutating;
    case 'string_format':
      return refusedName(check.format);
    case 'less_than':
      return refusedName('lt');
    case 'greater_than':
      return refusedName('gt');
    case 'multiple_of':
      return refusedName('multipleOf');
    case 'number_format':
    case 'bigint_format':
      return refusedName(check.format);
    case 'max_size':
      return refusedName('maxSize');
    case 'min_size':
      return refusedName('minSize');
    case 'size_equals':
      return refusedName('size');
    case 'max_length':
      return refusedName('maxLength');
    case 'min_length':
      return refusedName('minLength');
    case 'length_equals':
      return refusedName('length');
    case 'property':
      return refusedName('property');
    case 'mime_type':
      return refusedName('mime');
    case 'describe':
    case 'meta':
      return refusedName(check.check);
  }
}

function declaredCheckOf(instance: CheckInstance): DeclaredCheck {
  const constr = instance._zod.constr;
  return {
    def: instance._zod.def as CheckDef,
    rebuilt: (def) => (constr === undefined ? undefined : rebuiltDef(constr, def)),
  };
}

function rebuiltDef(constr: NonNullable<CheckInstance['_zod']['constr']>, def: object) {
  try {
    return new constr({ ...def })._zod.def as BuiltDef;
  } catch {
    return undefined;
  }
}

function isConstraintCheck(check: DeclaredCheck): boolean {
  return check.def.check !== 'describe' && check.def.check !== 'meta';
}
