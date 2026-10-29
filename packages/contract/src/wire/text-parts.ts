import type { ObjectNode } from '../walker/index.ts';
import type { TextIn, TextPartNodes } from '../written/index.ts';
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
      parts[textIn] = partValuesOf(textIn, node, source);
    }
  }
  return parts;
}

/** The values a part carries: its headers by their names, its params and query by their texts. */
function partValuesOf(textIn: TextIn, node: ObjectNode, source: TextSource): FieldValues {
  switch (textIn) {
    case 'params':
      return fieldValuesOf(node, (field) => listOf(source.params[field] ?? null));
    case 'query':
      return fieldValuesOf(node, (field) => source.query.getAll(field));
    case 'headers':
      return headerValuesOf(node, source.headers);
  }
}

/**
 * The values a party's headers carry, a request's or a Success's, each declared one present
 * converted by its node; one a message lacks is left out, so whether it is required is the schema's.
 */
export function headerValuesOf(node: ObjectNode, headers: Headers): FieldValues {
  return fieldValuesOf(node, (field) => listOf(headers.get(field)));
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

function listOf(text: string | null): readonly string[] {
  return text === null ? [] : [text];
}
