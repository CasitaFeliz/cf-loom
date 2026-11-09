import { inspect, types } from 'node:util';

type Hooked = () => unknown;

/** A value no setting's type allows, as untyped code can pass it, and what a refusal shows of it. */
export type Foreign = {
  readonly label: string;
  readonly value: unknown;
  /** What a refusal line of messaging shows of it: a primitive as `util.inspect` prints it, a list held as data with its entries, anything else its kind. */
  readonly shown: string;
  /** Whether reading it as one setting or a list of them runs its code before any refusal: the reader's, not the refusal's. */
  readonly readRunsCode: boolean;
};

/** The kinds a refusal shows differently: a primitive as it prints, a list, an object, a function, and a Proxy by its `typeof`. */
export function foreignKindOf(value: unknown): string {
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return typeof value;
  }
  if (types.isProxy(value)) {
    return 'proxy';
  }
  if (typeof value === 'function') {
    return 'function';
  }
  return Array.isArray(value) ? 'list' : 'object';
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

/** A value as a refusal shows it, made on demand so that its hooks call what a test gives. */
type Row = Omit<Foreign, 'value'> & { readonly make: (hooked: Hooked) => unknown };

function row(label: string, shown: string, make: Row['make']): Row {
  return { label, shown, make, readRunsCode: false };
}

/** A row whose value runs its own code when it is read as one setting or a list of them. */
function readRunning(read: Row): Row {
  return { ...read, readRunsCode: true };
}

const withHooks = (hooked: Hooked) => ({ [Symbol.toPrimitive]: hooked, toString: hooked });

const rows: readonly Row[] = [
  row('a custom inspect', 'an object', aCustomInspect),
  row('a custom inspect in a list', '[ an object ]', (hooked) => [aCustomInspect(hooked)]),
  row(
    'a custom inspect as a Map key',
    'an object',
    (hooked) => new Map([[aCustomInspect(hooked), 1]]),
  ),
  row(
    'an Error whose cause has a custom inspect',
    'an object',
    (hooked) => new Error('m', { cause: aCustomInspect(hooked) }),
  ),
  row('a function that converts itself to text', 'a function', (hooked) =>
    Object.assign(function aFunction() {}, withHooks(hooked)),
  ),
  row(
    'a multi-line function',
    'a function',
    () =>
      function aMultiLineFunction() {
        return 1;
      },
  ),
  row('an object whose prototype is a Proxy', 'an object', (hooked) =>
    Object.create(new Proxy({}, trapsCalling(hooked))),
  ),
  row('a RegExp with a source getter', 'an object', (hooked) =>
    Object.defineProperty(/a/, 'source', { get: hooked }),
  ),
  row('a Proxy object', 'an object', (hooked) => new Proxy({}, trapsCalling(hooked))),
  row(
    'a Proxy function',
    'a function',
    (hooked) => new Proxy(function aFunction() {}, trapsCalling(hooked)),
  ),
  readRunning(row('a Proxy list', 'a list', (hooked) => new Proxy(['1s'], trapsCalling(hooked)))),
  readRunning(
    row('a list with an index getter', 'a list', (hooked) =>
      Object.defineProperty([1, 2], 0, { get: hooked, enumerable: true }),
    ),
  ),
  row('an object with an enumerable getter', 'an object', (hooked) =>
    Object.defineProperty({}, 'a', { get: hooked, enumerable: true }),
  ),
  readRunning(
    row('an Array subclass with a species getter', "[ '1s' ]", anArraySubclassWithSpeciesGetter),
  ),
  row('an Error with a name getter', 'an object', (hooked) =>
    Object.defineProperty(new Error('m'), 'name', { get: hooked }),
  ),
  readRunning(
    row('a list with a Proxy prototype', "[ '30s' ]", (hooked) =>
      Object.setPrototypeOf(['30s'], new Proxy({}, trapsCalling(hooked))),
    ),
  ),
  row('a list with its own custom inspect', "[ '30s', '0s' ]", (hooked) =>
    Object.assign(['30s', '0s'], { [inspect.custom]: hooked }),
  ),
  row('a sparse list', 'a list', () => new Array(3)),
  row('an object with no prototype', 'an object', () => Object.create(null)),
  row('an object of seconds', 'an object', () => ({ seconds: 30 })),
  row('a list with an extra key', "[ '30s', '0s' ]", () =>
    Object.assign(['30s', '0s'], { extra: 1 }),
  ),
  readRunning(row('a revoked Proxy', 'an object', aRevokedProxy)),
  row('a Symbol with a line break', 'a symbol', () => Symbol('a\nb')),
  row('a bigint', 'a bigint', () => 10n),
];

/**
 * Values the setting types do not allow, which no refusal may run the code of: each hook they
 * carry calls `hooked`, which a test makes count or throw, and each is made new on each call.
 */
export function foreignValues(hooked: Hooked): readonly Foreign[] {
  return rows.map(({ make, ...foreign }) => ({ ...foreign, value: make(hooked) }));
}
