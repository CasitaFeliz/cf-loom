import type { $ZodInvalidTypeExpected, $ZodIssueTooSmall, $ZodRawIssue } from 'zod/v4/core';
import { writtenTextOf } from '../written/index.ts';

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
  object: 'an object',
  record: 'an object',
} satisfies Partial<Record<Named<$ZodInvalidTypeExpected>, string>>;

/** What a bound counts in the origins whose bounds are sizes, rather than values. */
const sizeUnits: Readonly<Record<string, string | undefined>> = {
  array: 'item',
  string: 'character',
} satisfies Partial<Record<Named<$ZodIssueTooSmall['origin']>, string>>;

function isNoValueOf(definer: string): string {
  return `is not a value ${definer} defines`;
}

function invalidTypeWords(issue: IssueOf<'invalid_type'>, definer: string): string {
  const expected = expectedTypes[issue.expected];
  return expected === undefined ? isNoValueOf(definer) : `is not ${expected}`;
}

function valuesWords(values: readonly unknown[]): string {
  const allowed = values.map(writtenTextOf).join(', ');
  return values.length === 1 ? `is not ${allowed}` : `is none of ${allowed}`;
}

/** A union keyed by a discriminator lists the values its options have, as an enum does. */
function invalidUnionWords(issue: IssueOf<'invalid_union'>, definer: string): string {
  if ('options' in issue && Array.isArray(issue.options)) {
    return valuesWords(issue.options);
  }
  return issue.errors.length === 0
    ? isNoValueOf(definer)
    : `matches none of the forms ${definer} defines`;
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
  switch (issue.code) {
    case 'invalid_type':
      return invalidTypeWords(issue, definer);
    case 'invalid_value':
      return valuesWords(issue.values);
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
      return invalidUnionWords(issue, definer);
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
 * own wording is never printed; a message a schema wrote for a value that is there keeps winning.
 */
export function issueWordsOf(definer: string): (issue: $ZodRawIssue) => string {
  return (issue) => wordsOf(issue, definer);
}
