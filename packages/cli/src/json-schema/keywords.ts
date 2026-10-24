/** A JSON Schema schema: a record of keywords, whose values may be `false`, which nothing matches. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** The JSON Schema a document's schemas follow: 2020-12, OpenAPI 3.1's, or draft-07, which AsyncAPI's Schema Object extends. */
export type JsonSchemaDialect = '2020-12' | 'draft-07';

/** An object made of the fields given, each one left out where its value is `undefined`. */
export function definedOf(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(fields).filter(isSet));
}

function isSet([, value]: readonly [string, unknown]): boolean {
  return value !== undefined;
}
