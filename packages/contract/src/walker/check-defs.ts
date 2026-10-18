import type * as core from 'zod/v4/core';
import { type Refused, refused, refusedName } from './not-allowed.ts';

/** A check as zod's def writes it; `describe` and `meta` are how `zod/mini` sets metadata. */
export type CheckDef =
  | (core.$ZodChecks | core.$ZodStringFormatChecks)['_zod']['def']
  | { readonly check: 'custom'; readonly type?: 'custom' }
  | { readonly check: 'describe' | 'meta' };

/** The checks a schema declares, its own first: a format schema such as `z.email()` is a check. */
export function checksOf(def: core.$ZodTypeDef): readonly CheckDef[] {
  const own = 'check' in def ? [def as CheckDef] : [];
  const listed = (def.checks ?? []).map((check) => check._zod.def as CheckDef);
  return [...own, ...listed].filter(isConstraintCheck);
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

function isConstraintCheck(check: CheckDef): boolean {
  return check.check !== 'describe' && check.check !== 'meta';
}
