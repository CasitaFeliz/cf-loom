import { inspect, types } from 'node:util';

type Hooked = () => unknown;

/** A value a test hands to a reader that its types do not allow, as untyped code can. */
export type Foreign = {
  readonly label: ForeignLabel;
  readonly value: unknown;
};

/** The kind of a value of the pool: its `typeof`, `null`, `proxy` for a Proxy, or `list` or `object`. */
export function foreignKindOf(value: unknown): string {
  if (types.isProxy(value)) {
    return 'proxy';
  }
  if (typeof value !== 'object') {
    return typeof value;
  }
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'list' : 'object';
}

/** A hook that records its call on `ran` and throws what the value's own code would, so a test sees the call even where the code under test swallows the throw. */
export function aHookThatThrows(ran: string[]): () => never {
  return () => {
    ran.push('ran');
    throw new Error('the value’s own code ran');
  };
}

/**
 * The traps of a Proxy that calls `hooked` whenever anything reads it, so a test counts the code
 * a value runs or has it throw.
 */
function trapsCalling(hooked: Hooked): ProxyHandler<object> {
  const hooking = <Result>(result: Result): Result => {
    hooked();
    return result;
  };
  return {
    get: (target, key) => hooking(Reflect.get(target, key)),
    ownKeys: (target) => hooking(Reflect.ownKeys(target)),
    getPrototypeOf: (target) => hooking(Reflect.getPrototypeOf(target)),
    getOwnPropertyDescriptor: (target, key) =>
      hooking(Reflect.getOwnPropertyDescriptor(target, key)),
    has: (target, key) => hooking(Reflect.has(target, key)),
  };
}

/** An object whose `[inspect.custom]` calls `hooked`, as `util.inspect` runs it. */
function aCustomInspect(hooked: Hooked): object {
  return { [inspect.custom]: hooked };
}

function anArraySubclassWithSpeciesGetter(hooked: Hooked): unknown {
  class Listed extends Array {
    static override get [Symbol.species]() {
      hooked();
      return Array;
    }
  }
  return Listed.from(['1s']);
}

function aRevokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

/** A value of the pool, made on demand so that its hooks call what a test gives. */
type Row<Label extends string> = {
  readonly label: Label;
  readonly make: (hooked: Hooked) => unknown;
};

function row<const Label extends string>(label: Label, make: Row<Label>['make']): Row<Label> {
  return { label, make };
}

const withHooks = (hooked: Hooked) => ({ [Symbol.toPrimitive]: hooked, toString: hooked });

const rows = [
  row('a custom inspect', aCustomInspect),
  row('a custom inspect in a list', (hooked) => [aCustomInspect(hooked)]),
  row('a custom inspect as a Map key', (hooked) => new Map([[aCustomInspect(hooked), 1]])),
  row(
    'an Error whose cause has a custom inspect',
    (hooked) => new Error('m', { cause: aCustomInspect(hooked) }),
  ),
  row('a function that converts itself to text', (hooked) =>
    Object.assign(function aFunction() {}, withHooks(hooked)),
  ),
  row(
    'a multi-line function',
    () =>
      function aMultiLineFunction() {
        return 1;
      },
  ),
  row('an object whose prototype is a Proxy', (hooked) =>
    Object.create(new Proxy({}, trapsCalling(hooked))),
  ),
  row('a RegExp with a source getter', (hooked) =>
    Object.defineProperty(/a/, 'source', { get: hooked }),
  ),
  row('a Proxy object', (hooked) => new Proxy({}, trapsCalling(hooked))),
  row('a Proxy function', (hooked) => new Proxy(function aFunction() {}, trapsCalling(hooked))),
  row('a Proxy list', (hooked) => new Proxy(['1s'], trapsCalling(hooked))),
  row('a list with an index getter', (hooked) =>
    Object.defineProperty([1, 2], 0, { get: hooked, enumerable: true }),
  ),
  row('an object with an enumerable getter', (hooked) =>
    Object.defineProperty({}, 'a', { get: hooked, enumerable: true }),
  ),
  row('an Array subclass with a species getter', anArraySubclassWithSpeciesGetter),
  row('an Error with a name getter', (hooked) =>
    Object.defineProperty(new Error('m'), 'name', { get: hooked }),
  ),
  row('a list with a Proxy prototype', (hooked) =>
    Object.setPrototypeOf(['30s'], new Proxy({}, trapsCalling(hooked))),
  ),
  row('a list with its own custom inspect', (hooked) =>
    Object.assign(['30s', '0s'], { [inspect.custom]: hooked }),
  ),
  row('a sparse list', () => new Array(3)),
  row('an object with no prototype', () => Object.create(null)),
  row('an object of seconds', () => ({ seconds: 30 })),
  row('a list with an extra key', () => Object.assign(['30s', '0s'], { extra: 1 })),
  row('a revoked Proxy', aRevokedProxy),
  row('a Symbol with a line break', () => Symbol('a\nb')),
  row('a bigint', () => 10n),
] as const;

/** What a value of the pool is called, which a test keys what it expects of each value by. */
export type ForeignLabel = (typeof rows)[number]['label'];

/**
 * Values that no setting, name or code of a declaration allows, which no reading of them may run
 * the code of: each hook they carry calls `hooked`, and each is made new on each call.
 */
export function foreignValues(hooked: Hooked): readonly Foreign[] {
  return rows.map(({ label, make }) => ({ label, value: make(hooked) }));
}
