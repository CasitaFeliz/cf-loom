import type * as core from 'zod/v4/core';

/** A check as zod's def writes it; `describe` and `meta` are how `zod/mini` sets metadata. */
export type CheckDef =
  | (core.$ZodChecks | core.$ZodStringFormatChecks | core.$ZodCheckProperties)['_zod']['def']
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
