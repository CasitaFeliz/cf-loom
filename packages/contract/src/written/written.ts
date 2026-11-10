/** A plain object an author wrote: not a list, not `null`, with no prototype but Object's or none. */
export type WrittenObject = Readonly<Record<string, unknown>>;

/**
 * A list as written, whatever the types said: what a cast put where a list belongs and is none
 * is empty, and a hole in a sparse list is an item that is missing.
 */
export function listOf<Item>(list: readonly Item[] | undefined): readonly Item[];
export function listOf(list: unknown): readonly unknown[];
export function listOf(list: unknown): readonly unknown[] {
  return Array.isArray(list) ? Array.from(list) : [];
}

/** Whether a value is a plain object, as an author writes a part or a declaration. */
export function isPlainObject(value: unknown): value is WrittenObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A value a map holds itself under a name, as JSON holds it: nothing it only inherits, so a key a
 * Contract names never reads `Object.prototype`'s; nor anything of a list or a non-object.
 */
export function ownOf(map: unknown, name: string): unknown {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return undefined;
  }
  return Object.hasOwn(map, name) ? Reflect.get(map, name) : undefined;
}

/**
 * Whether a value is absent at a path: a step on the way, or the last, is a key the value does not
 * hold itself, a hole of a list included, or the value there is `undefined`.
 */
export function isAbsentAt(input: unknown, path: readonly PropertyKey[]): boolean {
  let value = input;
  for (const step of path) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, step)) {
      return true;
    }
    value = Reflect.get(value, step);
  }
  return value === undefined;
}

/** A part a declaration may leave out is empty; what a cast put there that is no object is too. */
export function partOf<Key extends string>(part: unknown): Partial<Readonly<Record<Key, unknown>>> {
  return isPlainObject(part) ? (part as Partial<Readonly<Record<Key, unknown>>>) : {};
}

/** The entries of a map an author wrote; none when what sits there is no object. */
export function entriesOf(value: unknown): readonly (readonly [string, unknown])[] {
  return isPlainObject(value) ? Object.entries(value) : [];
}

/** Whether a field was left out: `undefined`. Writing `null` is never leaving a field out. */
export function isMissing(value: unknown): value is undefined {
  return value === undefined;
}

/** Whether a required field has no value: left out, or written as `null`. */
export function isWithoutValue(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

/**
 * The words that name a value with no text of its own, running none of its code: `a function`,
 * `a symbol`, `a bigint`, `a list` or `an object`, a revoked Proxy being `an object`; none for a
 * string, a number, a boolean, `null` or `undefined`.
 */
export function kindWordsOf(value: unknown): string | undefined {
  switch (typeof value) {
    case 'function':
      return 'a function';
    case 'symbol':
      return 'a symbol';
    case 'bigint':
      return 'a bigint';
    case 'object':
      return value === null ? undefined : objectWordsOf(value);
    default:
      return undefined;
  }
}

/** `Array.isArray` runs no trap of a live Proxy; it throws for a revoked Proxy, or for a chain of Proxies deeper than the stack, which are named `an object`. */
function objectWordsOf(value: object): string {
  try {
    return Array.isArray(value) ? 'a list' : 'an object';
  } catch {
    return 'an object';
  }
}

/** A value as a sentence or a location names it, running none of its code: its own text, or the words of its kind. */
export function textOf(value: unknown): string {
  return kindWordsOf(value) ?? String(value);
}

/**
 * A written value as a message echoes it: a string JSON-quoted, so its spaces and line breaks
 * show and `"409"` is told from `409`, anything else in `textOf`'s words.
 */
export function writtenTextOf(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : textOf(value);
}

/** Whether a list field lists nothing: left out or an empty list; anything else is the structure rule's. */
export function isEmptyField(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}
