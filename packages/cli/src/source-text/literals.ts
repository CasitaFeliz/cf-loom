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

/** How a JSON literal is laid out: on one line, or indented by two spaces as JSON text is. */
export type JsonLayout = 'inline' | 'indented';

/**
 * A JSON value as a TypeScript expression that evaluates to the same value: a `__proto__` key,
 * at any depth, is computed, since a literal one sets the prototype instead.
 */
export function jsonLiteralOf(value: unknown, layout: JsonLayout = 'inline'): string {
  return literalAt(value, layout, '');
}

function literalAt(value: unknown, layout: JsonLayout, indent: string): string {
  if (Array.isArray(value)) {
    return listOf(
      value.map((item) => literalAt(item, layout, `${indent}  `)),
      ['[', ']'],
      { layout, indent },
    );
  }
  if (typeof value !== 'object' || value === null) {
    return JSON.stringify(value);
  }
  const separator = layout === 'inline' ? ':' : ': ';
  const entries = Object.entries(value).map(
    ([key, item]) => `${jsonKeyOf(key)}${separator}${literalAt(item, layout, `${indent}  `)}`,
  );
  return listOf(entries, ['{', '}'], { layout, indent });
}

function listOf(
  items: readonly string[],
  [open, close]: readonly [string, string],
  { layout, indent }: { readonly layout: JsonLayout; readonly indent: string },
): string {
  if (items.length === 0) {
    return `${open}${close}`;
  }
  if (layout === 'inline') {
    return `${open}${items.join(',')}${close}`;
  }
  return `${open}\n${items.map((item) => `${indent}  ${item}`).join(',\n')}\n${indent}${close}`;
}

function jsonKeyOf(key: string): string {
  return key === '__proto__' ? `[${JSON.stringify(key)}]` : JSON.stringify(key);
}

/** A value a Snapshot's literal or enum holds. */
export type LiteralValue = string | number | boolean;

/** A string, number or boolean as a TypeScript literal, a value and a type alike. */
export function literalOf(value: LiteralValue): string {
  return typeof value === 'string' ? stringLiteralOf(value) : String(value);
}

/** A key of an object literal or type: bare when it is an identifier, else quoted. */
export function keyOf(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : stringLiteralOf(name);
}
