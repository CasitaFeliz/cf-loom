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

function canonicalObject(value: object): string {
  const present = Object.entries(value).filter(hasValue);
  const keys = present.map(([key]) => key).sort(byCodePoint);
  const valueByKey = new Map(present);
  const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(valueByKey.get(key))}`);
  return `{${members.join(',')}}`;
}

function hasValue(entry: [string, unknown]): boolean {
  return entry[1] !== undefined;
}

function byCodePoint(left: string, right: string): number {
  const leftPoints = Array.from(left, codePointOf);
  const rightPoints = Array.from(right, codePointOf);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function codePointOf(character: string): number {
  return character.codePointAt(0) ?? 0;
}
