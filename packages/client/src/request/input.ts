import type { Endpoint } from '@casitafeliz/loom-contract';
import {
  demandIssuesOf,
  headerTextsOf,
  type InputIssue,
  inputParts,
  isQueryText,
  isSegmentText,
  isTextValue,
  notJsonBodyIssue,
  parsedPartsOf,
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

/**
 * The Input a Caller passed, checked as the Provider checks it: each attached Guard's demands in
 * Attachment order, the first that fails answering alone; then a declared body left out, which is
 * no JSON and answers alone; then each declared part of the Input, parsed with its schema; then
 * its text, that it can travel.
 */
export function readyInputOf(endpoint: Endpoint, passed: unknown): ReadyInput {
  const sent = sentInputOf(passed);
  const demandIssues = demandIssuesOf(endpoint, sent);
  if (demandIssues.length > 0) {
    return { kind: 'invalid', issues: demandIssues };
  }
  if (schemaOf(endpoint, 'input.body') !== undefined && sent['body'] === undefined) {
    return { kind: 'invalid', issues: [notJsonBodyIssue] };
  }
  const input = parsedPartsOf(inputParts, (part) => schemaOf(endpoint, part), sent);
  if (input.kind === 'issues') {
    return { kind: 'invalid', issues: input.issues };
  }
  return travelingInputOf(input.value);
}

/**
 * The Input as the Provider will read it: a text part left out sends no field, and a query list
 * with no items sends no key, which the Provider reads as absent, so each is parsed as absent.
 */
function sentInputOf(passed: unknown): Readonly<Record<string, unknown>> {
  const fields = fieldsIn(passed);
  const query = fields['query'] ?? {};
  return {
    ...fields,
    params: fields['params'] ?? {},
    headers: fields['headers'] ?? {},
    query: isFields(query) ? withoutEmptyListsOf(query) : query,
  };
}

function withoutEmptyListsOf(
  query: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(query).filter(([, item]) => !isEmptyList(item)));
}

function travelingInputOf(parsed: Readonly<Record<string, unknown>>): ReadyInput {
  const params = fieldsIn(parsed['params']);
  const query = definedFieldsOf(fieldsIn(parsed['query']));
  const headers = headerTextsOf('input.headers', fieldsIn(parsed['headers']));
  const textIssues = [...paramIssuesOf(params), ...queryIssuesOf(query)];
  switch (headers.kind) {
    case 'issues':
      return { kind: 'invalid', issues: [...textIssues, ...headers.issues] };
    case 'texts': {
      if (textIssues.length > 0) {
        return { kind: 'invalid', issues: textIssues };
      }
      const ready = { params, query, headers: headers.texts };
      return {
        kind: 'ready',
        input: 'body' in parsed ? { ...ready, body: parsed['body'] } : ready,
      };
    }
  }
}

/** A path param whose text cannot arrive as its own segment. */
function paramIssuesOf(params: Readonly<Record<string, unknown>>): readonly InputIssue[] {
  const unsendable = Object.entries(params).filter(([, value]) => !isSegmentText(textOf(value)));
  return unsendable.map(([name]) => ({
    part: 'input.params',
    path: [name],
    code: 'invalid_format',
    message: 'The path param cannot travel as a URL segment',
  }));
}

/** A query value, or a list's item, whose text cannot arrive as itself. */
function queryIssuesOf(query: Readonly<Record<string, unknown>>): readonly InputIssue[] {
  const items = Object.entries(query).flatMap(([name, value]) => itemsOf(name, value));
  const unsendable = items.filter(([, item]) => !isQueryText(textOf(item)));
  return unsendable.map(([path]) => ({
    part: 'input.query',
    path,
    code: 'invalid_format',
    message: 'The query value cannot travel as URL text',
  }));
}

/** A query field's values with their paths: each item of a list, or the one value. */
function itemsOf(
  name: string,
  value: unknown,
): readonly (readonly [readonly (string | number)[], unknown])[] {
  if (!Array.isArray(value)) {
    return [[[name], value]];
  }
  return value.map((item: unknown, index) => [[name, index], item] as const);
}

/** A parsed value of a text part as its text: a Contract's text parts hold nothing else. */
export function textOf(value: unknown): string {
  if (!isTextValue(value)) {
    throw new Error('A text part holds a value that is no string, number or boolean');
  }
  return textOfValue(value);
}

function definedFieldsOf(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
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
