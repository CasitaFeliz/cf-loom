/** A text as a single-quoted TypeScript string, so generated code reads like the repository's. */
export function stringLiteralOf(text: string): string {
  const escaped = JSON.stringify(text)
    .slice(1, -1)
    .replace(/\\.|'/g, (token) => singleQuotedOf(token));
  return `'${escaped}'`;
}

/** One escape of a double-quoted JSON string, or a quote, as a single-quoted string writes it. */
function singleQuotedOf(token: string): string {
  if (token === '\\"') {
    return '"';
  }
  return token === "'" ? "\\'" : token;
}

/** A JSON value as a TypeScript expression on one line. */
export function jsonLiteralOf(value: unknown): string {
  return JSON.stringify(value);
}

/** A value a Snapshot's literal or enum holds. */
export type LiteralValue = string | number | boolean;

/** A string, number or boolean as a TypeScript literal, a value and a type alike. */
export function literalOf(value: LiteralValue): string {
  return typeof value === 'string' ? stringLiteralOf(value) : String(value);
}

/**
 * A key of an object literal or type: bare when it is an identifier, else quoted, and
 * `__proto__` computed, since a literal `__proto__` key sets the prototype instead.
 */
export function keyOf(name: string): string {
  if (name === '__proto__') {
    return `[${stringLiteralOf(name)}]`;
  }
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : stringLiteralOf(name);
}
