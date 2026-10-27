import { z } from 'zod';
import * as zm from 'zod/mini';
import * as core from 'zod/v4/core';

/** The node types a check is put on, by name. */
export type NodeName = 'string' | 'number' | 'array' | 'object' | 'boolean' | 'nullable string';

/** A flavor of zod, `zod` or `zod/mini`: its exports and the schemas a check is put on. */
export type Flavor = {
  readonly name: 'zod' | 'zod/mini';
  readonly api: Readonly<Record<string, unknown>>;
  readonly nodes: () => Readonly<Record<NodeName, core.$ZodType>>;
};

/** A check zod builds, by the spelling that builds it. */
export type NamedCheck = { readonly name: string; readonly check: core.$ZodCheck };

/** What a sweep of zod's exports found: the checks it built, and the exports that threw. */
export type Swept = {
  readonly checks: readonly NamedCheck[];
  readonly thrown: readonly string[];
};

/** What a sweep of a schema's methods found, and the methods it called. */
export type SweptMethods = Swept & { readonly called: readonly string[] };

export const zodFlavor: Flavor = {
  name: 'zod',
  api: z,
  nodes: () => ({
    string: z.string(),
    number: z.number(),
    array: z.array(z.string()),
    object: z.object({}),
    boolean: z.boolean(),
    'nullable string': z.nullable(z.string()),
  }),
};

export const miniFlavor: Flavor = {
  name: 'zod/mini',
  api: zm,
  nodes: () => ({
    string: zm.string(),
    number: zm.number(),
    array: zm.array(zm.string()),
    object: zm.object({}),
    boolean: zm.boolean(),
    'nullable string': zm.nullable(zm.string()),
  }),
};

export const flavors: readonly Flavor[] = [zodFlavor, miniFlavor];

/** The schema with a check added, as `.check()` adds it. */
export function checked(schema: core.$ZodType, check: core.$ZodCheck): core.$ZodType {
  const def = schema._zod.def;
  return core.clone(schema, { ...def, checks: [...(def.checks ?? []), check] });
}

/** Exports that change zod's global state, so a sweep never calls them. */
const notCalled: readonly string[] = ['setErrorMap'];

const noop = () => undefined;

/** The arguments the check builders and methods that take any are called with. */
const namedArgs: Readonly<Record<string, readonly unknown[]>> = {
  regex: [/a/],
  startsWith: ['a'],
  endsWith: ['a'],
  includes: ['a'],
  mime: [['text/plain']],
  hash: ['md5'],
  stringFormat: ['x', () => true],
  property: ['a', z.string()],
  properties: [{}],
  instanceof: [Date],
  refine: [() => true],
  superRefine: [noop],
  check: [noop],
  with: [noop],
  overwrite: [(value: unknown) => value],
  describe: ['d'],
  meta: [{}],
};

/** The checks that take a bound, which an export is called with `1` for. */
const boundedExports: ReadonlySet<string> = new Set([
  'gt',
  'gte',
  'lt',
  'lte',
  'minimum',
  'maximum',
  'multipleOf',
  'maxSize',
  'minSize',
  'size',
  'maxLength',
  'minLength',
  'length',
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Whether a value is a check as zod's `.check()` takes it: it holds a def with a `check`. */
function isCheck(value: unknown): value is core.$ZodCheck {
  const internals = isRecord(value) ? Reflect.get(value, '_zod') : undefined;
  const def = isRecord(internals) ? Reflect.get(internals, 'def') : undefined;
  return isRecord(def) && typeof Reflect.get(def, 'check') === 'string';
}

/** Whether an export is a function a sweep calls: a lowercase one that does not change zod. */
function isCalled(name: string, value: unknown): value is (...args: readonly unknown[]) => unknown {
  return typeof value === 'function' && !/^[A-Z$_]/.test(name) && !notCalled.includes(name);
}

/** A call's result, with a rejected promise swallowed so it never escapes the sweep. */
function settled(result: unknown): unknown {
  if (result instanceof Promise) {
    result.catch(noop);
    return undefined;
  }
  return result;
}

/** Every check builder `zod` or `zod/mini` exports, at its top level and in `iso`. */
export function sweepExports({ api }: Flavor): Swept {
  const swept = sweepIn(api, '');
  const iso = Reflect.get(api, 'iso');
  const inIso = isRecord(iso) ? sweepIn(iso, 'iso.') : { checks: [], thrown: [] };
  return {
    checks: [...swept.checks, ...inIso.checks],
    thrown: [...swept.thrown, ...inIso.thrown],
  };
}

function sweepIn(exports: Readonly<Record<string, unknown>>, prefix: string): Swept {
  const checks: NamedCheck[] = [];
  const thrown: string[] = [];
  for (const [name, value] of Object.entries(exports)) {
    if (!isCalled(name, value)) {
      continue;
    }
    const args = namedArgs[name] ?? (boundedExports.has(name) ? [1] : []);
    try {
      const result = settled(value(...args));
      if (isCheck(result)) {
        checks.push({ name: `${prefix}${name}`, check: result });
      }
    } catch {
      thrown.push(`${prefix}${name}`);
    }
  }
  return { checks, thrown };
}

/** The schemas whose methods are swept, by the node type they are. */
function homes(): Readonly<Record<string, core.$ZodType>> {
  return {
    string: z.string(),
    number: z.number(),
    bigint: z.bigint(),
    date: z.date(),
    array: z.array(z.string()),
    set: z.set(z.string()),
    map: z.map(z.string(), z.string()),
    file: z.file(),
    object: z.object({}),
    boolean: z.boolean(),
  };
}

const boundsByHome: Readonly<Record<string, unknown>> = { bigint: 1n, date: new Date(0) };

function namesOfMethods(home: object): readonly string[] {
  const names = new Set<string>();
  for (let level: object | null = home; level !== null; level = Reflect.getPrototypeOf(level)) {
    if (level === Object.prototype) {
      break;
    }
    for (const name of Object.getOwnPropertyNames(level)) {
      names.add(name);
    }
  }
  names.delete('constructor');
  return [...names].sort();
}

/** Every method of a classic schema that adds a check, by the check it adds. */
export function sweepMethods(): SweptMethods {
  const checks: NamedCheck[] = [];
  const called = new Set<string>();
  const thrown = new Set<string>();
  for (const [homeName, home] of Object.entries(homes())) {
    const before = home._zod.def.checks?.length ?? 0;
    for (const name of namesOfMethods(home)) {
      const method = Reflect.get(home, name);
      if (typeof method !== 'function') {
        continue;
      }
      called.add(name);
      try {
        const args = namedArgs[name] ?? [boundsByHome[homeName] ?? 1];
        const result = settled(Reflect.apply(method, home, args));
        const added = addedCheckOf(result, before);
        if (added !== undefined) {
          checks.push({ name, check: added });
        }
      } catch {
        thrown.add(name);
      }
    }
  }
  return { checks, called: [...called].sort(), thrown: [...thrown].sort() };
}

/** The check a method added to a schema that had `before` checks, if it added one. */
function addedCheckOf(result: unknown, before: number): core.$ZodCheck | undefined {
  const internals = isRecord(result) ? Reflect.get(result, '_zod') : undefined;
  const def = isRecord(internals) ? Reflect.get(internals, 'def') : undefined;
  const checks: unknown = isRecord(def) ? Reflect.get(def, 'checks') : undefined;
  if (!Array.isArray(checks) || checks.length <= before) {
    return undefined;
  }
  const added: unknown = checks.at(-1);
  return isCheck(added) ? added : undefined;
}
