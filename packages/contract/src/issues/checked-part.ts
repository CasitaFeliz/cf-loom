import type * as core from 'zod/v4/core';
import type { Issue, IssuePart } from '../written/index.ts';
import { encodedValueOf, type Parsed, parseValue } from './parse-value.ts';

/** Where in its part a given value sits; the part itself when left out. */
type Path = readonly (string | number)[];

/** What a writer gave for one part, and where in the part it sits. */
export type GivenPart = { readonly value: unknown; readonly at?: Path };

/** A part a writer gave, checked: its value, or every Issue at that part. */
export type Checked<Value = unknown> =
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'issues'; readonly issues: readonly Issue[] };

/**
 * A part a writer gave, parsed with the schema its declaration gives it, as a Provider reads what
 * its Handler built; where the declaration gives it none, no value may be given.
 */
export function parsedPartOf<Schema extends core.$ZodType>(
  part: IssuePart,
  schema: Schema | undefined,
  given: GivenPart,
): Checked<core.output<Schema> | undefined> {
  const check = schema === undefined ? undefined : (value: unknown) => parseValue(schema, value);
  return checkedPartOf(part, check, given);
}

/**
 * A part a writer gave as its readers read it, written back through its Reader schema as it
 * travels; where the declaration gives it none, no value may be given.
 */
export function writtenPartOf(
  part: IssuePart,
  reader: core.$ZodType | undefined,
  given: GivenPart,
): Checked {
  const check =
    reader === undefined ? undefined : (value: unknown) => encodedValueOf(reader, value);
  return checkedPartOf(part, check, given);
}

/**
 * The one rule for a part a writer gives: where its declaration gives it no schema, the value must
 * be missing, since a part no declaration names is never sent; where it does, the schema decides.
 */
function checkedPartOf<Value>(
  part: IssuePart,
  check: ((value: unknown) => Parsed<Value>) | undefined,
  given: GivenPart,
): Checked<Value | undefined> {
  const at = given.at ?? [];
  if (check === undefined) {
    if (given.value === undefined) {
      return { kind: 'value', value: undefined };
    }
    const issue = { part, path: at, code: 'invalid_type', message: 'Expected no value' } as const;
    return { kind: 'issues', issues: [issue] };
  }
  const checked = check(given.value);
  if (checked.kind === 'value') {
    return checked;
  }
  const issues = checked.issues.map((issue) => ({ part, ...issue, path: [...at, ...issue.path] }));
  return { kind: 'issues', issues };
}
