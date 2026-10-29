import type { BuiltDef, DeclaredCheck } from './check-defs.ts';
import { refusedCheck } from './check-names.ts';
import { formatOptionsOf } from './format-options.ts';
import { isStringFormat, regexBuiltFormatOf, type StringFormat } from './format-schemas.ts';
import type { StringNode } from './nodes.ts';
import {
  notAllowed,
  type Refused,
  refused,
  refusedRegexBuiltFormat,
  refusedStringFormat,
} from './not-allowed.ts';
import { type Reached, type Walked, walked } from './walked.ts';

/** What the walker reads of a string format check, from zod and `zod/mini` alike. */
type FormatDef = BuiltDef & {
  readonly format: string;
  readonly pattern?: RegExp | undefined;
  readonly fn?: ((value: string) => unknown) | undefined;
  readonly normalize?: boolean | undefined;
};

/** A format check of a format SNAPSHOT.md knows. */
type KnownFormatDef = FormatDef & { readonly format: StringFormat };

/** Whether a format check names a format SNAPSHOT.md knows. */
function isKnownFormat(def: FormatDef): def is KnownFormatDef {
  return isStringFormat(def.format);
}

/**
 * The `format` and `formatOptions` a string format check declares: only a format zod builds
 * itself from options, checked as zod checks it, with the options that differ from zod's default.
 * A check zod runs through a function is refused, whatever pattern sits beside it, since no
 * reading of a function proves what it tests: `z.stringFormat()`, and the formats zod builds from
 * a regex, which `.regex()` with that regex replaces.
 */
export function formatOf(check: DeclaredCheck, at: Reached): Walked<Partial<StringNode>> {
  const def = check.def as unknown as FormatDef;
  if (def.normalize === true) {
    return notAllowed(at, refused.urlNormalize);
  }
  if (def.fn !== undefined) {
    return notAllowed(at, functionFormatRefusalOf(def.format));
  }
  if (!isKnownFormat(def)) {
    return notAllowed(at, refusedCheck(check.def));
  }
  return builtFormatOf(check, def, at);
}

/** A format check that runs a function: a format zod builds from a regex by its call, else by its name. */
function functionFormatRefusalOf(format: string): Refused {
  const regexBuilt = regexBuiltFormatOf(format);
  return regexBuilt === undefined
    ? refusedStringFormat(format)
    : refusedRegexBuiltFormat(regexBuilt.call, regexBuilt.regex);
}

/** A format zod builds from its options: the pattern must be the one zod builds for them. */
function builtFormatOf(
  check: DeclaredCheck,
  def: KnownFormatDef,
  at: Reached,
): Walked<Partial<StringNode>> {
  const options = formatOptionsOf(check);
  if (options === undefined) {
    return notAllowed(at, refusedStringFormat(def.format));
  }
  if (options.kind === 'custom-pattern') {
    return notAllowed(at, refused.customPattern);
  }
  if (Object.keys(options.declared).length === 0) {
    return walked({ format: def.format });
  }
  return walked({ format: def.format, formatOptions: options.declared });
}
