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

/** A value as a sentence or a location names it; an object has no text of its own. */
export function textOf(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return Array.isArray(value) ? 'a list' : 'an object';
  }
  return String(value);
}
