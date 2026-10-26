import type { $ZodRawIssue } from 'zod/v4/core';

type IssueOf<Code extends string> = Extract<$ZodRawIssue, { readonly code: Code }>;

const expectedTypes: Readonly<Record<string, string>> = {
  string: 'a string',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  tuple: 'a list',
  object: 'an object',
  record: 'an object',
  null: 'null',
};

const sizeUnits: ReadonlyMap<string, string> = new Map([
  ['string', 'character'],
  ['file', 'byte'],
]);

const sizedOrigins: ReadonlySet<string> = new Set(['array', 'set', 'string', 'file']);

function invalidTypeWords(issue: IssueOf<'invalid_type'>): string {
  if (issue.input === undefined) {
    return 'is missing';
  }
  return `is not ${expectedTypes[issue.expected] ?? `of the type ${issue.expected}`}`;
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function invalidValueWords({ values }: IssueOf<'invalid_value'>): string {
  const allowed = values.map(valueText).join(', ');
  return values.length === 1 ? `is not ${allowed}` : `is none of ${allowed}`;
}

function sizeWords(
  issue: { readonly origin: string; readonly exact?: boolean | undefined },
  limit: number | bigint,
  comparison: 'fewer' | 'more',
): string {
  const unit = sizeUnits.get(issue.origin) ?? 'item';
  const size = `${limit} ${Number(limit) === 1 ? unit : `${unit}s`}`;
  return issue.exact === true
    ? `does not hold exactly ${size}`
    : `holds ${comparison} than ${size}`;
}

function tooSmallWords(issue: IssueOf<'too_small'>): string {
  if (sizedOrigins.has(issue.origin)) {
    return sizeWords(issue, issue.minimum, 'fewer');
  }
  return `${issue.inclusive === false ? 'is not above' : 'is below'} ${issue.minimum}`;
}

function tooBigWords(issue: IssueOf<'too_big'>): string {
  if (sizedOrigins.has(issue.origin)) {
    return sizeWords(issue, issue.maximum, 'more');
  }
  return `${issue.inclusive === false ? 'is not below' : 'is above'} ${issue.maximum}`;
}

function invalidFormatWords(issue: IssueOf<'invalid_format'>): string {
  return issue.format === 'regex'
    ? `does not match ${issue.pattern}`
    : `is not in the ${issue.format} format`;
}

function wordsOf(issue: $ZodRawIssue, definer: string): string {
  switch (issue.code) {
    case 'invalid_type':
      return invalidTypeWords(issue);
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
        ? `is not a value ${definer} defines`
        : `matches none of the forms ${definer} defines`;
    case 'invalid_key':
      return `is a key that is not a value ${definer} defines`;
    case 'invalid_element':
      return `holds an element that is not a value ${definer} defines`;
    case 'custom':
      return `is not a value ${definer} defines`;
  }
}

/**
 * Words each issue a schema did not word itself, one case for each of zod's issue codes, so zod's
 * own wording is never printed; a message a schema wrote keeps winning, as zod ranks them.
 */
export function issueWordsOf(definer: string): (issue: $ZodRawIssue) => string {
  return (issue) => wordsOf(issue, definer);
}
