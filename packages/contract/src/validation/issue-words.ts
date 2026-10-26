import type { $ZodInvalidTypeExpected, $ZodIssueTooSmall, $ZodRawIssue } from 'zod/v4/core';

type IssueOf<Code extends string> = Extract<$ZodRawIssue, { readonly code: Code }>;

/** The members of a string union that zod names, without the `(string & {})` it leaves open. */
type Named<Open extends string> = Open extends unknown
  ? string extends Open
    ? never
    : Open
  : never;

const expectedTypes: Readonly<Record<string, string | undefined>> = {
  string: 'a string',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  tuple: 'a list',
  object: 'an object',
  record: 'an object',
  null: 'null',
} satisfies Partial<Record<Named<$ZodInvalidTypeExpected>, string>>;

/** What a bound counts in the origins whose bounds are sizes, rather than values. */
const sizeUnits: Readonly<Record<string, string | undefined>> = {
  array: 'item',
  set: 'item',
  string: 'character',
  file: 'byte',
} satisfies Partial<Record<Named<$ZodIssueTooSmall['origin']>, string>>;

function isNoValueOf(definer: string): string {
  return `is not a value ${definer} defines`;
}

function valueAt(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined;
}

/** A value is missing when the key that should hold it holds nothing, or no option names it. */
function isMissing(issue: $ZodRawIssue): boolean {
  if (issue.code === 'invalid_union' && issue.discriminator !== undefined) {
    return valueAt(issue.input, issue.discriminator) === undefined;
  }
  return issue.input === undefined;
}

function invalidTypeWords(issue: IssueOf<'invalid_type'>, definer: string): string {
  const expected = expectedTypes[issue.expected];
  return expected === undefined ? isNoValueOf(definer) : `is not ${expected}`;
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function invalidValueWords({ values }: IssueOf<'invalid_value'>): string {
  const allowed = values.map(valueText).join(', ');
  return values.length === 1 ? `is not ${allowed}` : `is none of ${allowed}`;
}

function sizeText(limit: number | bigint, unit: string): string {
  return `${limit} ${Number(limit) === 1 ? unit : `${unit}s`}`;
}

function sizeWords(exact: boolean | undefined, size: string, comparison: 'fewer' | 'more'): string {
  return exact === true ? `does not hold exactly ${size}` : `holds ${comparison} than ${size}`;
}

function tooSmallWords(issue: IssueOf<'too_small'>): string {
  const unit = sizeUnits[issue.origin];
  if (unit === undefined) {
    return `${issue.inclusive === false ? 'is not above' : 'is below'} ${issue.minimum}`;
  }
  return sizeWords(issue.exact, sizeText(issue.minimum, unit), 'fewer');
}

function tooBigWords(issue: IssueOf<'too_big'>): string {
  const unit = sizeUnits[issue.origin];
  if (unit === undefined) {
    return `${issue.inclusive === false ? 'is not below' : 'is above'} ${issue.maximum}`;
  }
  return sizeWords(issue.exact, sizeText(issue.maximum, unit), 'more');
}

function invalidFormatWords(issue: IssueOf<'invalid_format'>): string {
  return issue.format === 'regex'
    ? `does not match ${issue.pattern}`
    : `is not in the ${issue.format} format`;
}

function wordsOf(issue: $ZodRawIssue, definer: string): string {
  if (isMissing(issue)) {
    return 'is missing';
  }
  switch (issue.code) {
    case 'invalid_type':
      return invalidTypeWords(issue, definer);
    case 'invalid_value':
      return invalidValueWords(issue);
    case 'too_small':
      return tooSmallWords(issue);
    case 'too_big':
      return tooBigWords(issue);
    case 'invalid_format':
      return invalidFormatWords(issue);
    case 'not_multiple_of':
      return `is not a multiple of ${issue.divisor}`;
    case 'unrecognized_keys':
      return `is a key ${definer} does not define`;
    case 'invalid_union':
      return issue.errors.length === 0
        ? isNoValueOf(definer)
        : `matches none of the forms ${definer} defines`;
    case 'invalid_key':
      return `is a key that is not a value ${definer} defines`;
    case 'invalid_element':
      return `holds an element that is not a value ${definer} defines`;
    case 'custom':
      return isNoValueOf(definer);
  }
}

/**
 * Words each issue a schema did not word itself, one case for each of zod's issue codes, so zod's
 * own wording is never printed; a message a schema wrote keeps winning, as zod ranks them.
 */
export function issueWordsOf(definer: string): (issue: $ZodRawIssue) => string {
  return (issue) => wordsOf(issue, definer);
}
