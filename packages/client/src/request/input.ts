import type { Endpoint } from '@casitafeliz/loom-contract';
import {
  attachmentsOf,
  demandParts,
  fieldsOf,
  headerTextsOf,
  type InputIssue,
  type InputPart,
  inputParts,
  isQueryText,
  isSegmentText,
  parseValue,
  schemaOf,
  textOfValue,
} from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';

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

/** The parts of one party parsed, by field, and every Issue found in them. */
type ParsedParts = {
  readonly values: Readonly<Partial<Record<string, unknown>>>;
  readonly issues: readonly InputIssue[];
};

/**
 * The Input a Caller passed, checked as the Provider checks it: each attached Guard's demands in
 * Attachment order, the first that fails answering alone; then each declared part of the Input,
 * parsed with its schema; then its text, that it can travel.
 */
export function readyInputOf(endpoint: Endpoint, passed: unknown): ReadyInput {
  for (const { guard } of attachmentsOf(endpoint)) {
    const demands = parsedPartsOf(demandParts, (part) => schemaOf(guard, part), passed);
    if (demands.issues.length > 0) {
      return { kind: 'invalid', issues: demands.issues };
    }
  }
  const input = parsedPartsOf(inputParts, (part) => schemaOf(endpoint, part), passed);
  if (input.issues.length > 0) {
    return { kind: 'invalid', issues: input.issues };
  }
  return travelingInputOf(input.values);
}

/** Each part of one party, a Guard's demands or an Endpoint's Input, parsed by its schema. */
function parsedPartsOf<Part extends InputPart>(
  parts: readonly Part[],
  schemaAt: (part: Part) => core.$ZodType | undefined,
  passed: unknown,
): ParsedParts {
  const values: Partial<Record<string, unknown>> = {};
  const issues: InputIssue[] = [];
  for (const part of parts) {
    const schema = schemaAt(part);
    if (schema === undefined) {
      continue;
    }
    const field = fieldsOf(part)[1];
    const parsed = parseValue(schema, sentValueOf(part, fieldOf(passed, field)));
    if (parsed.kind === 'issues') {
      issues.push(...parsed.issues.map((issue) => ({ part, ...issue })));
    } else {
      values[field] = parsed.value;
    }
  }
  return { values, issues };
}

/**
 * A part's value as the Provider will read it: a text part left out sends no field, and a query
 * list with no items sends no key, which the Provider reads as absent, so it is parsed as absent.
 */
function sentValueOf(part: InputPart, value: unknown): unknown {
  if (part !== 'input.body' && value === undefined) {
    return {};
  }
  if ((part !== 'input.query' && part !== 'demands.query') || !isFields(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).filter(([, item]) => !isEmptyList(item)));
}

function travelingInputOf(parsed: Readonly<Partial<Record<string, unknown>>>): ReadyInput {
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
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
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

function fieldOf(value: unknown, field: string): unknown {
  return isFields(value) ? value[field] : undefined;
}
