import type { TextIn, TextPartNodes } from '../validation/index.ts';
import type { ObjectNode } from '../walker/index.ts';
import { valueOfText } from './text.ts';

/** Where a request's text comes from: its matched params by name, its query and its headers. */
export type TextSource = {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: Headers;
};

/** Values by field, as one text part of a request carries them. */
type FieldValues = Readonly<Record<string, unknown>>;

/** The parts a request carries as text, each with the field a Handler reads it under. */
const requestTextParts = [
  ['input.params', 'params'],
  ['input.query', 'query'],
  ['input.headers', 'headers'],
  ['demands.query', 'query'],
  ['demands.headers', 'headers'],
] as const;

/**
 * Each text part a party declares, an Endpoint's Input or a Guard's demands, read from the request
 * field by field and converted by its node; a field the request lacks is left out, so whether it is
 * required is the schema's to say.
 */
export function textPartsOf(
  nodes: TextPartNodes,
  source: TextSource,
): Readonly<Partial<Record<TextIn, FieldValues>>> {
  const parts: Partial<Record<TextIn, FieldValues>> = {};
  for (const [part, textIn] of requestTextParts) {
    const node = nodes[part];
    if (node !== undefined) {
      parts[textIn] = fieldValuesOf(node, (field) => textsOf(textIn, field, source));
    }
  }
  return parts;
}

function fieldValuesOf(
  node: ObjectNode,
  textsAt: (field: string) => readonly string[],
): FieldValues {
  const values: (readonly [string, unknown])[] = [];
  for (const [field, { schema }] of Object.entries(node.fields)) {
    const texts = textsAt(field);
    if (texts.length > 0) {
      values.push([field, valueOfText(schema, texts)]);
    }
  }
  return Object.fromEntries(values);
}

/** The texts a field arrives as: a param or header once, a query key as often as it is repeated. */
function textsOf(textIn: TextIn, field: string, source: TextSource): readonly string[] {
  switch (textIn) {
    case 'params':
      return listOf(source.params[field] ?? null);
    case 'query':
      return source.query.getAll(field);
    case 'headers':
      return listOf(source.headers.get(field));
  }
}

function listOf(text: string | null): readonly string[] {
  return text === null ? [] : [text];
}
