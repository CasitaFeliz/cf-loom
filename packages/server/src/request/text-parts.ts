import { type ObjectNode, valueOfText } from '@casitafeliz/loom-contract/internal';

/** The text parts one party reads, an Endpoint's Input or a Guard's demands, each as its walked node. */
export type TextNodes = {
  readonly params?: ObjectNode | undefined;
  readonly query?: ObjectNode | undefined;
  readonly headers?: ObjectNode | undefined;
};

/** Where a request's text comes from: its matched params by name, its query and its headers. */
export type TextSource = {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: Headers;
};

type TextPartName = keyof TextNodes;

/** Values by field, as one text part of a request carries them. */
type FieldValues = Readonly<Record<string, unknown>>;

/**
 * Each text part a party declares, read from the request field by field and converted by its node;
 * a field the request lacks is left out, so whether it is required is the schema's to say.
 */
export function textPartsOf(
  nodes: TextNodes,
  source: TextSource,
): Readonly<Partial<Record<TextPartName, FieldValues>>> {
  const parts: Partial<Record<TextPartName, FieldValues>> = {};
  for (const part of ['params', 'query', 'headers'] as const) {
    const node = nodes[part];
    if (node !== undefined) {
      parts[part] = fieldValuesOf(node, (field) => textsOf(part, field, source));
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
function textsOf(part: TextPartName, field: string, source: TextSource): readonly string[] {
  switch (part) {
    case 'params':
      return listOf(Object.hasOwn(source.params, field) ? (source.params[field] ?? null) : null);
    case 'query':
      return source.query.getAll(field);
    case 'headers':
      return listOf(source.headers.get(field));
  }
}

function listOf(text: string | null): readonly string[] {
  return text === null ? [] : [text];
}
