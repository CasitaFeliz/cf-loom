/** A JSON Schema 2020-12 schema: a record of keywords, whose values may be `false`, which nothing matches. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** An object made of the fields given, each one left out where its value is `undefined`. */
export function definedOf(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(fields).filter(isSet));
}

function isSet([, value]: readonly [string, unknown]): boolean {
  return value !== undefined;
}
