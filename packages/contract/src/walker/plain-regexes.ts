import type { Regex } from './nodes.ts';

const sourceGetter = prototypeGetterOf('source');
const flagsGetter = prototypeGetterOf('flags');

/**
 * The source and flags of a regex zod tests through `RegExp.prototype`, as it tests a literal: a RegExp of this
 * realm, whose prototype is `RegExp.prototype` and whose one own property is a writable `lastIndex`. None for any
 * other value, a subclass, a RegExp of another realm, one with a property of its own, a Proxy or no RegExp at all,
 * since zod calls that value's own `test`, which no reading of its source and flags proves.
 */
export function plainRegexOf(value: unknown): Regex | undefined {
  const source = regExpSourceOf(value);
  if (source === undefined || !hasNothingOfItsOwn(value as object)) {
    return undefined;
  }
  return { source, flags: Reflect.apply(flagsGetter, value, []) };
}

/**
 * The source of a value holding a RegExp's internal slot, read by `RegExp.prototype`'s getter, which
 * refuses any other value, a Proxy included, before running any code of the value's own.
 */
function regExpSourceOf(value: unknown): string | undefined {
  try {
    return Reflect.apply(sourceGetter, value, []);
  } catch {
    return undefined;
  }
}

/** Whether a RegExp of this realm's kind runs as a literal: nothing of its own but a writable `lastIndex`. */
function hasNothingOfItsOwn(regex: object): boolean {
  if (Object.getPrototypeOf(regex) !== RegExp.prototype) {
    return false;
  }
  const keys = Reflect.ownKeys(regex);
  const lastIndex = Object.getOwnPropertyDescriptor(regex, 'lastIndex');
  return keys.length === 1 && keys[0] === 'lastIndex' && lastIndex?.writable === true;
}

/** A getter of `RegExp.prototype`, taken once, so what runs is never a property of the value's own. */
function prototypeGetterOf(key: 'source' | 'flags'): () => string {
  const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get;
  if (getter === undefined) {
    throw new Error(
      `RegExp.prototype has no ${key} getter: this runtime is not one cf-loom supports.`,
    );
  }
  return getter;
}
