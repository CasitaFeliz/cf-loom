import type { Endpoint } from '@cf-loom/contract';
import {
  headerTextsOf,
  type InputIssue,
  isQueryText,
  isSegmentText,
  isTextValue,
  notJsonContentType,
  readingOf,
  textOfValue,
} from '@cf-loom/contract/internal';

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
 * The Input a Caller passed, read as the Provider reads the request it would send, every Guard
 * admitting it and a body left out sent with no content type; then its text, that it can travel,
 * the Guards' demands with the Input's.
 */
export async function readyInputOf(endpoint: Endpoint, passed: unknown): Promise<ReadyInput> {
  const sent = sentInputOf(passed);
  const body =
    sent['body'] === undefined
      ? notJsonContentType
      : { kind: 'value' as const, value: sent['body'] };
  const demanded: Readonly<Record<string, unknown>>[] = [];
  const reading = await readingOf(endpoint, {
    textOf: () => sent,
    body: () => Promise.resolve(body),
    admit: (_index, demands) => {
      demanded.push(demands);
      return Promise.resolve({ kind: 'admitted' });
    },
  });
  switch (reading.kind) {
    case 'stopped':
      return reading.answer;
    case 'invalid':
      return reading;
    case 'input':
      return travelingInputOf(reading.input, demanded);
  }
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

function travelingInputOf(
  parsed: Readonly<Record<string, unknown>>,
  demands: readonly Readonly<Record<string, unknown>>[],
): ReadyInput {
  const params = fieldsIn(parsed['params']);
  const query = definedFieldsOf(sentFieldsOf('query', parsed, demands));
  const headers = headerTextsOf('input.headers', sentFieldsOf('headers', parsed, demands));
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

/**
 * The fields the Provider reads from a part: those its Guards demand and those the Input declares;
 * a name both declare holds the one value the Caller passed, whichever is kept.
 */
function sentFieldsOf(
  field: 'query' | 'headers',
  parsed: Readonly<Record<string, unknown>>,
  demands: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  const parts = [...demands, parsed].map((source) => fieldsIn(source[field]));
  return Object.assign({}, ...parts);
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

/** Whether a value is a record of fields: an object that is neither `null` nor an array. */
export function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldsIn(value: unknown): Readonly<Record<string, unknown>> {
  return isFields(value) ? value : {};
}
