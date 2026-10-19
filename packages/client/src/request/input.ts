import type { Endpoint } from '@casitafeliz/loom-contract';
import {
  fieldsOf,
  headerTextsOf,
  type InputIssue,
  type InputPart,
  inputParts,
  parseValue,
  schemaOf,
  textOfValue,
} from '@casitafeliz/loom-contract/internal';

/** An Input's parts as parsed, unknown keys stripped, by the field a Caller passes each under. */
export type ParsedInput = {
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: readonly (readonly [string, string])[];
  readonly body?: unknown;
};

/** An Input ready to travel, or every Issue that keeps it from being sent. */
export type ReadyInput =
  | { readonly kind: 'ready'; readonly input: ParsedInput }
  | { readonly kind: 'invalid'; readonly issues: readonly InputIssue[] };

/** The texts WHATWG URL parsing resolves away, so a path param holding one cannot reach its segment. */
const unsendableParams: ReadonlySet<string> = new Set(['', '.', '..']);

/**
 * The Input a Caller passed, each declared part parsed with its schema as the Provider will parse
 * it, then checked that its text can travel: a header as field text, a path param as a segment.
 */
export function readyInputOf(endpoint: Endpoint, passed: unknown): ReadyInput {
  const parsed: Partial<Record<string, unknown>> = {};
  const issues: InputIssue[] = [];
  for (const part of inputParts) {
    const schema = schemaOf(endpoint, part);
    if (schema === undefined) {
      continue;
    }
    const field = fieldsOf(part)[1];
    const value = parseValue(schema, sentValueOf(part, fieldOf(passed, field)));
    if (value.kind === 'issues') {
      issues.push(...value.issues.map((issue) => ({ part, ...issue })));
    } else {
      parsed[field] = value.value;
    }
  }
  if (issues.length > 0) {
    return { kind: 'invalid', issues };
  }
  return travelingInputOf(parsed);
}

/**
 * A part's value as the Provider will read it: a text part left out sends no field, and a query
 * list with no items sends no key, which the Provider reads as absent, so it is parsed as absent.
 */
function sentValueOf(part: InputPart, value: unknown): unknown {
  if (part !== 'input.body' && value === undefined) {
    return {};
  }
  if (part !== 'input.query' || !isFields(value)) {
    return value;
  }
  const sent = Object.entries(value).filter(([, item]) => !isEmptyList(item));
  return Object.fromEntries(sent);
}

function travelingInputOf(parsed: Partial<Record<string, unknown>>): ReadyInput {
  const params = fieldsIn(parsed['params']);
  const headers = headerTextsOf('input.headers', fieldsIn(parsed['headers']));
  const issues = [...paramIssuesOf(params), ...(headers.kind === 'issues' ? headers.issues : [])];
  if (headers.kind === 'issues' || issues.length > 0) {
    return { kind: 'invalid', issues: issues.filter(isInputIssue) };
  }
  const query = fieldsIn(parsed['query']);
  const ready = { params, query, headers: headers.texts };
  return { kind: 'ready', input: 'body' in parsed ? { ...ready, body: parsed['body'] } : ready };
}

function paramIssuesOf(params: Readonly<Record<string, unknown>>): readonly InputIssue[] {
  const unsendable = Object.entries(params).filter(([, value]) =>
    unsendableParams.has(textOf(value)),
  );
  return unsendable.map(([name]) => ({
    part: 'input.params',
    path: [name],
    code: 'invalid_value',
    message: 'The path param cannot travel as a URL segment',
  }));
}

/** A parsed value of a text part as its text: a Contract's text parts hold nothing else. */
export function textOf(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error('A text part holds a value that is no string, number or boolean');
  }
  return textOfValue(value);
}

function isInputIssue(issue: { readonly part: string }): issue is InputIssue {
  return issue.part === 'input.headers' || issue.part === 'input.params';
}

function isEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldsIn(value: unknown): Readonly<Record<string, unknown>> {
  return isFields(value) ? value : {};
}

function fieldOf(value: unknown, field: string): unknown {
  return isFields(value) ? value[field] : undefined;
}
