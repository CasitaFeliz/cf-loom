/** Whether a value is a JSON scalar other than `null`: a string, a finite number or a boolean. */
export function isJsonPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);
}

/** Whether a value is a number JSON can write: `NaN` and `Infinity` have no JSON text. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Whether a value is JSON: scalars, `null`, and lists and plain objects of JSON, with no cycle. */
export function isJsonValue(value: unknown, ancestors: readonly object[] = []): boolean {
  if (value === null || isJsonPrimitive(value)) {
    return true;
  }
  if (typeof value !== 'object' || ancestors.includes(value)) {
    return false;
  }
  const isPlain = Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
  const inside = [...ancestors, value];
  return isPlain && Object.values(value).every((member) => isJsonValue(member, inside));
}

/** A value as JSON with object keys sorted by code point, so equal values give equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return canonicalObject(value);
  }
  return JSON.stringify(value);
}

/** Orders values by their canonical JSON, for the arrays whose order means nothing. */
export function byCanonicalJson(left: unknown, right: unknown): number {
  return byCodePoint(canonicalJson(left), canonicalJson(right));
}

/**
 * The values of an array whose order means nothing as a Snapshot holds them: each once, by its
 * canonical JSON, in that order, which the decoder requires back.
 */
export function inCanonicalJsonOrder<Value>(values: readonly Value[]): Value[] {
  const valueByJson = new Map(values.map((value) => [canonicalJson(value), value]));
  return [...valueByJson.values()].sort(byCanonicalJson);
}

/**
 * A value as a file holds it: canonical JSON indented by two spaces, one member or item per line,
 * so a change to one value is a change to one line of a review's diff. The keys of `first` that
 * the outermost object holds are written before the rest, in that order.
 */
export function indentedCanonicalJson(value: unknown, first: readonly string[] = []): string {
  return indentedAt(value, '', first);
}

/** Orders text by code point, as the Snapshot orders keys and the arrays whose order means nothing. */
export function byCodePoint(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; ) {
    const leftPoint = left.codePointAt(index) ?? 0;
    const rightPoint = right.codePointAt(index) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
    index += leftPoint > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function canonicalObject(value: object): string {
  const members = membersOf(value, []).map(
    ([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`,
  );
  return `{${members.join(',')}}`;
}

/**
 * An object's members that have a value, the keys of `first` leading in the order given and the
 * rest by key in code point order, whatever order JS keeps.
 */
function membersOf(
  value: object,
  first: readonly string[],
): readonly (readonly [string, unknown])[] {
  const present = Object.entries(value).filter(hasValue);
  const leading: (readonly [string, unknown])[] = [];
  for (const key of first) {
    const member = present.find(([name]) => name === key);
    if (member !== undefined) {
      leading.push(member);
    }
  }
  const rest = present.filter(([key]) => !first.includes(key));
  return [...leading, ...rest.sort(([left], [right]) => byCodePoint(left, right))];
}

function hasValue(entry: [string, unknown]): boolean {
  return entry[1] !== undefined;
}

function indentedAt(value: unknown, indent: string, first: readonly string[]): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((item) => `${inner}${indentedAt(item, inner, [])}`);
    return items.length === 0 ? '[]' : `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const members = membersOf(value, first).map(
      ([key, member]) => `${inner}${JSON.stringify(key)}: ${indentedAt(member, inner, [])}`,
    );
    return members.length === 0 ? '{}' : `{\n${members.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}
