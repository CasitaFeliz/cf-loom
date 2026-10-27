import type * as core from 'zod/v4/core';
import { type Refused, refused, zodCall } from './not-allowed.ts';

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
export function refusedCheck(check: CheckDef): Refused {
  return { construct: nameOfCheck(check) };
}

/** A check as the Not allowed list names it: the zod function that writes it. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the name of each check zod has
export function nameOfCheck(check: CheckDef): string {
  switch (check.check) {
    case 'custom':
      return (check.type === 'custom' ? refused.refine : refused.customCheck).construct;
    case 'overwrite':
      return refused.mutating.construct;
    case 'string_format':
      return zodCall(check.format);
    case 'less_than':
      return zodCall('lt');
    case 'greater_than':
      return zodCall('gt');
    case 'multiple_of':
      return zodCall('multipleOf');
    case 'number_format':
      return zodCall(check.format === 'safeint' ? 'int' : check.format);
    case 'bigint_format':
      return zodCall(check.format);
    case 'max_size':
      return zodCall('maxSize');
    case 'min_size':
      return zodCall('minSize');
    case 'size_equals':
      return zodCall('size');
    case 'max_length':
      return zodCall('maxLength');
    case 'min_length':
      return zodCall('minLength');
    case 'length_equals':
      return zodCall('length');
    case 'property':
      return zodCall('property');
    case 'mime_type':
      return zodCall('mime');
    case 'describe':
    case 'meta':
      return zodCall(check.check);
  }
}

function declaredCheckOf(instance: CheckInstance): DeclaredCheck {
  return { def: instance._zod.def as CheckDef, rebuilt: (def) => rebuiltDef(instance, def) };
}

/** A built-in check zod made without a constructor is a zod newer than this walker: a bug. */
function rebuiltDef(instance: CheckInstance, def: object): BuiltDef | undefined {
  const constr = instance._zod.constr;
  if (constr === undefined) {
    throw new Error(
      'A zod check has no constructor: this zod is newer than cf-loom supports; report it to cf-loom.',
    );
  }
  try {
    return new constr({ ...def })._zod.def as BuiltDef;
  } catch {
    return undefined;
  }
}

function isConstraintCheck(check: DeclaredCheck): boolean {
  return check.def.check !== 'describe' && check.def.check !== 'meta';
}
