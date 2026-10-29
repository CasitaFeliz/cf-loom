import type { BuiltDef, DeclaredCheck } from './check-defs.ts';
import { refusedCheck, refusedRegexBuiltFormat } from './check-names.ts';
import { formatOptionsOf } from './format-options.ts';
import { isStringFormat, regexBuiltFormatOf, type StringFormat } from './format-schemas.ts';
import type { Regex, StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedStringFormat } from './not-allowed.ts';
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
 * What a string format check declares as data, a `regex` or a known `format` with its
 * `formatOptions`; a check that runs a function is refused, since no reading of a function proves
 * what it tests.
 */
export function formatOf(check: DeclaredCheck, at: Reached): Walked<Partial<StringNode>> {
  const def = check.def as unknown as FormatDef;
  if (def.normalize === true) {
    return notAllowed(at, refused.urlNormalize);
  }
  if (def.fn !== undefined) {
    return notAllowed(at, functionFormatRefusalOf(def.format));
  }
  if (def.format === 'regex' && def.pattern !== undefined) {
    return walked({ regex: regexOf(def.pattern) });
  }
  if (!isKnownFormat(def)) {
    return notAllowed(at, refusedCheck(check.def));
  }
  return builtFormatOf(check, def, at);
}

function regexOf(pattern: RegExp): Regex {
  return { source: pattern.source, flags: pattern.flags };
}

/** A format check that runs a function: a format zod builds from a regex by its spellings, else by its name. */
function functionFormatRefusalOf(format: string): Refused {
  const regexBuilt = regexBuiltFormatOf(format);
  return regexBuilt === undefined
    ? refusedStringFormat(format)
    : refusedRegexBuiltFormat(format, regexBuilt);
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
