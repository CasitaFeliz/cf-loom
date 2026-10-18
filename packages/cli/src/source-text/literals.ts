/** A text as a single-quoted TypeScript string, so generated code reads like the repository's. */
export function stringLiteralOf(text: string): string {
  const escaped = JSON.stringify(text).slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'");
  return `'${escaped}'`;
}

/** A JSON value as a TypeScript expression on one line. */
export function jsonLiteralOf(value: unknown): string {
  return JSON.stringify(value);
}

/** A key of an object literal: bare when it is an identifier, else quoted. */
export function keyOf(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : stringLiteralOf(name);
}
