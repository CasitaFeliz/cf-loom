import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineCommand,
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  openEnum,
} from '../index.ts';
import { type SchemaNode, validateContract, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function walkedTo(node: SchemaNode) {
  return { located: [{ at: ['body'], walked: { kind: 'walked', value: node } }], defs: {} };
}

function refusedAt(at: readonly (string | number)[], construct: string, instead?: string) {
  const failure = { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
  return {
    located: [{ at: ['body'], walked: { kind: 'not-allowed', failures: [failure] } }],
    defs: {},
  };
}

const keyedRecord = 'a z.record() or z.partialRecord() keyed by an enum or literal';
const keyedRecordInstead = 'z.object() with the keys as fields';

const text = { type: 'string' } as const;
const amount = { type: 'number' } as const;

describe('walkSchemas: objects', () => {
  test('an object is open with each field required', () => {
    const order = z.object({ id: z.string(), total: z.number() });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        fields: { id: { required: true, schema: text }, total: { required: true, schema: amount } },
      }),
    );
  });

  test.each([
    ['z.strictObject()', z.strictObject({ id: z.string() })],
    ['.strict()', z.object({ id: z.string() }).strict()],
    ['a zod/mini strictObject()', zm.strictObject({ id: zm.string() })],
  ])('%s fails, naming z.object(), since objects are open', (_written, schema) => {
    expect(walkBody(schema)).toEqual(
      refusedAt(['body'], 'z.strictObject()', 'z.object(): objects are open'),
    );
  });

  test('an optional field is not required', () => {
    expect(walkBody(z.object({ note: z.string().optional() }))).toEqual(
      walkedTo({
        type: 'object',
        fields: { note: { required: false, schema: text } },
      }),
    );
  });

  test('a nullable field is required and nullable', () => {
    const order = z.object({ note: z.string().nullable() });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        fields: { note: { required: true, schema: { type: 'string', nullable: true } } },
      }),
    );
  });

  test('a nullish field is optional and nullable, each its own flag', () => {
    const order = z.object({ note: z.string().nullish() });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        fields: { note: { required: false, schema: { type: 'string', nullable: true } } },
      }),
    );
  });

  test('optional anywhere but directly on an object field fails', () => {
    expect(walkBody(z.array(z.string().optional()))).toEqual(
      refusedAt(['body', 'items'], '.optional()'),
    );
  });

  test('a check on an optional field fails like a check on any schema', () => {
    const order = z.object({
      note: z
        .string()
        .optional()
        .refine((note) => note !== ''),
    });

    expect(walkBody(order)).toEqual(refusedAt(['body', 'fields', 'note'], '.refine()'));
  });

  test('.required() makes an optional field required', () => {
    const order = z.object({ note: z.string().optional(), id: z.string() }).required();

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        fields: { note: { required: true, schema: text }, id: { required: true, schema: text } },
      }),
    );
  });

  test('a zod/mini optional field is not required', () => {
    expect(walkBody(zm.object({ note: zm.optional(zm.string()) }))).toEqual(
      walkedTo({
        type: 'object',
        fields: { note: { required: false, schema: text } },
      }),
    );
  });
});

describe('walkSchemas: records', () => {
  test('a string-keyed record is a record', () => {
    expect(walkBody(z.record(z.string(), z.number()))).toEqual(
      walkedTo({ type: 'record', key: text, value: amount }),
    );
  });

  test.each([
    ['an enum', z.record(z.enum(['eur', 'usd']), z.number())],
    ['a literal', z.record(z.literal('eur'), z.number())],
    ['a union of literals', z.record(z.union([z.literal('eur'), z.literal('usd')]), z.number())],
    ['a literal of several values', z.record(z.literal(['eur', 'usd']), z.number())],
    ['an enum, partial', z.partialRecord(z.enum(['eur', 'usd']), z.number())],
    ['a literal, partial', z.partialRecord(z.literal('eur'), z.number())],
    ['an enum holding __proto__', z.record(z.enum(['__proto__', 'a']), z.number())],
  ])('a record keyed by %s fails, naming z.object() with the keys as fields', (_key, schema) => {
    expect(walkBody(schema)).toEqual(refusedAt(['body'], keyedRecord, keyedRecordInstead));
  });

  test('a record keyed by an enum fails with the failures of its value', () => {
    const schema = z.record(
      z.enum(['eur']),
      z.number().refine((total) => total > 0),
    );

    expect(walkBody(schema)).toEqual({
      located: [
        {
          at: ['body'],
          walked: {
            kind: 'not-allowed',
            failures: [
              {
                kind: 'not-allowed',
                at: ['body'],
                construct: keyedRecord,
                instead: keyedRecordInstead,
              },
              { kind: 'not-allowed', at: ['body', 'value'], construct: '.refine()' },
            ],
          },
        },
      ],
      defs: {},
    });
  });

  test('a partial record keyed by a string is the same record as one that is not partial', () => {
    const partial = z.partialRecord(z.string(), z.number());

    expect(walkBody(partial)).toEqual(walkBody(z.record(z.string(), z.number())));
  });

  test('a record keyed by a string with a constraint is a record', () => {
    expect(walkBody(z.record(z.string().min(2), z.number()))).toEqual(
      walkedTo({ type: 'record', key: { type: 'string', min: 2 }, value: amount }),
    );
  });

  test.each([
    ['string', z.string().nullable()],
    ['enum', z.enum(['eur']).nullable()],
  ])('a record with a nullable %s key fails', (_kind, key) => {
    const keyTypedAsString = key as unknown as z.ZodString;

    expect(walkBody(z.record(keyTypedAsString, z.number()))).toEqual(
      refusedAt(['body'], 'a nullable z.record() key'),
    );
  });

  test('a record keyed by an openEnum fails', () => {
    expect(walkBody(z.record(openEnum(['eur', 'usd']), z.number()))).toEqual(
      refusedAt(['body'], 'a z.record() keyed by an openEnum()', 'z.record(z.string(), …)'),
    );
  });

  test('a number-keyed record fails', () => {
    expect(walkBody(z.record(z.number(), z.string()))).toEqual(
      refusedAt(['body'], 'a z.record() key that is not a string'),
    );
  });
});

describe('walkSchemas: intersections', () => {
  test('an intersection of open objects whose shared keys agree is one open object', () => {
    const named = z.object({ id: z.string(), name: z.string() });
    const priced = z.object({ id: z.string(), total: z.number() });

    expect(walkBody(z.intersection(named, priced))).toEqual(
      walkedTo({
        type: 'object',
        fields: {
          id: { required: true, schema: text },
          name: { required: true, schema: text },
          total: { required: true, schema: amount },
        },
      }),
    );
  });

  test('an intersection with a record keyed by an enum fails once, at the record', () => {
    const named = z.record(z.enum(['name']), z.string());
    const priced = z.object({ total: z.number() });

    expect(walkBody(named.and(priced))).toEqual(
      refusedAt(['body', 'items', 0], keyedRecord, keyedRecordInstead),
    );
  });

  test('an intersection of objects whose shared key differs fails', () => {
    const named = z.object({ id: z.string() });
    const numbered = z.object({ id: z.number() });

    expect(walkBody(named.and(numbered))).toEqual(
      refusedAt(['body'], 'an intersection of objects whose shared keys differ', '.extend()'),
    );
  });

  test('an intersection whose shared field differs by its description alone keeps the left one', () => {
    const left = z.object({ id: z.string().describe('A') });
    const right = z.object({ id: z.string().describe('B'), total: z.number() });

    expect(walkBody(z.intersection(left, right))).toEqual(
      walkedTo({
        type: 'object',
        fields: {
          id: { required: true, schema: { type: 'string', description: 'A' } },
          total: { required: true, schema: amount },
        },
      }),
    );
  });

  test('an intersection whose shared field is required on one side only fails', () => {
    const left = z.object({ id: z.string() });
    const right = z.object({ id: z.string().optional() });

    expect(walkBody(z.intersection(left, right))).toEqual(
      refusedAt(['body'], 'an intersection of objects whose shared keys differ', '.extend()'),
    );
  });

  const named = z.object({ name: z.string() });
  const hasToString = z.object({ toString: z.string() });
  test.each([
    ['first', z.intersection(hasToString, named), 0],
    ['second', z.intersection(named, hasToString), 1],
  ])(
    'a key named like an Object method, in the %s object, fails like in any object',
    (_order, intersection, item) => {
      expect(walkBody(intersection)).toEqual(
        refusedAt(['body', 'items', item, 'fields', 'toString'], everyObjectHas('toString')),
      );
    },
  );

  test('an intersection of a schema with itself is an allOf holding it once', () => {
    expect(walkBody(z.intersection(z.string(), z.string()))).toEqual(
      walkedTo({ type: 'allOf', items: [text] }),
    );
  });

  test('any other intersection is allOf', () => {
    const bounded = z.intersection(z.string().min(1), z.string().max(10));

    expect(walkBody(bounded)).toEqual(
      walkedTo({
        type: 'allOf',
        items: [
          { type: 'string', max: 10 },
          { type: 'string', min: 1 },
        ],
      }),
    );
  });
});

describe('walkSchemas: a field named __proto__', () => {
  const construct = 'a field named __proto__ (zod drops it when parsing)';

  test('an object field named __proto__ is not allowed', () => {
    const schema = z.object({ ['__proto__']: z.string(), b: z.string() });

    expect(walkBody(schema)).toEqual(refusedAt(['body', 'fields', '__proto__'], construct));
  });

  test('a discriminator named __proto__ is not allowed', () => {
    const schema = z.discriminatedUnion('__proto__', [z.object({ ['__proto__']: z.literal('a') })]);

    expect(walkBody(schema)).toEqual(
      refusedAt(['body', 'variants', 0, 'fields', '__proto__'], construct),
    );
  });

  test('a record keyed by any string is allowed', () => {
    const schema = z.record(z.string(), z.number());

    expect(walkBody(schema).located[0]?.walked.kind).toBe('walked');
  });
});

/** The names every plain object has, read from the platform the tests run on. */
const inheritedNames = Object.getOwnPropertyNames(Object.prototype);

function everyObjectHas(name: string) {
  return `a field named ${name}, which every object already has (zod reads it from Object.prototype when it is absent)`;
}

describe('walkSchemas: a field named what every object already has', () => {
  test('an object field named constructor is not allowed', () => {
    const schema = z.object({ constructor: z.string().optional(), b: z.string() });

    expect(walkBody(schema)).toEqual(
      refusedAt(['body', 'fields', 'constructor'], everyObjectHas('constructor')),
    );
  });

  test('an object field named toString is not allowed two objects deep', () => {
    const schema = z.object({ a: z.object({ b: z.object({ toString: z.number().optional() }) }) });

    expect(walkBody(schema)).toEqual(
      refusedAt(
        ['body', 'fields', 'a', 'fields', 'b', 'fields', 'toString'],
        everyObjectHas('toString'),
      ),
    );
  });

  test('an object field named valueOf is not allowed inside the value of a record', () => {
    const schema = z.record(z.string(), z.object({ valueOf: z.number().optional() }));

    expect(walkBody(schema)).toEqual(
      refusedAt(['body', 'value', 'fields', 'valueOf'], everyObjectHas('valueOf')),
    );
  });

  test('a variant of a discriminated union with a field named hasOwnProperty is not allowed', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), hasOwnProperty: z.string().optional() }),
    ]);

    expect(walkBody(schema)).toEqual(
      refusedAt(
        ['body', 'variants', 0, 'fields', 'hasOwnProperty'],
        everyObjectHas('hasOwnProperty'),
      ),
    );
  });

  test('a refused field is reported beside the failures of its own schema', () => {
    const schema = z.object({ constructor: z.date() });

    expect(walkBody(schema)).toEqual({
      located: [
        {
          at: ['body'],
          walked: {
            kind: 'not-allowed',
            failures: [
              {
                kind: 'not-allowed',
                at: ['body', 'fields', 'constructor'],
                construct: everyObjectHas('constructor'),
              },
              {
                kind: 'not-allowed',
                at: ['body', 'fields', 'constructor'],
                construct: 'z.date()',
                instead: 'z.iso.datetime()',
              },
            ],
          },
        },
      ],
      defs: {},
    });
  });

  test.each(['then', 'toJSON', '__proto', 'Constructor', 'tostring'])(
    'an object field named %s is allowed, since no object has it',
    (name) => {
      const schema = z.object({ [name]: z.string().optional() });

      expect(walkBody(schema).located[0]?.walked.kind).toBe('walked');
    },
  );

  test('a field is refused exactly when every object has its name', () => {
    const next = seededNext(273);
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$-. ';
    let refusals = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const name = aFieldName(next, alphabet);
      const schema = z.object({ [name]: z.string().optional() });

      const kind = walkBody(schema).located[0]?.walked.kind;

      const refusedName = inheritedNames.includes(name);
      refusals += refusedName ? 1 : 0;
      expect(kind, `draw ${draw}: ${JSON.stringify(name)}`).toBe(
        refusedName ? 'not-allowed' : 'walked',
      );
    }
    expect(refusals).toBeGreaterThan(30);
  });
});

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A name every object has, one that differs from it by a letter's case or an extra character, or a random string. */
function aFieldName(next: () => number, alphabet: string): string {
  const inherited = inheritedNames[Math.floor(next() * inheritedNames.length)] ?? 'constructor';
  const draw = next();
  if (draw < 0.3) {
    return inherited;
  }
  if (draw < 0.4) {
    return `${inherited.slice(0, 1).toUpperCase()}${inherited.slice(1)}`;
  }
  if (draw < 0.5) {
    return `${inherited}${alphabet[Math.floor(next() * alphabet.length)]}`;
  }
  const length = 1 + Math.floor(next() * 12);
  return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
}

/** A Contract whose one Endpoint attaches one Guard and answers one Rejection, and whose Group lists a body each. */
function contractWith(parts: {
  readonly path?: string;
  readonly eventBody?: core.$ZodType;
  readonly commandBody?: core.$ZodType;
  readonly guard?: Parameters<typeof defineGuard>[0];
  readonly input?: Parameters<typeof defineEndpoint>[0]['input'];
  readonly success?: Parameters<typeof defineEndpoint>[0]['success'];
  readonly rejectionBody?: core.$ZodType;
}) {
  const guard = defineGuard(parts.guard ?? { name: 'gate', description: 'Gate' });
  const denied = defineRejection({
    code: 'DENIED',
    status: 403,
    message: 'Denied',
    ...(parts.rejectionBody && { body: parts.rejectionBody }),
  });
  const echo = defineEndpoint({
    name: 'echo',
    method: 'POST',
    path: parts.path ?? '/echo',
    visibility: 'public',
    description: 'Echo',
    guards: [guard.qualifier === undefined ? guard : { guard, qualifier: { scope: 'x' } }],
    ...(parts.input && { input: parts.input }),
    success: parts.success ?? { status: 204 },
    rejections: [denied],
  } as never);
  const events = parts.eventBody === undefined ? [] : [anEvent(parts.eventBody)];
  const commands = parts.commandBody === undefined ? [] : [aCommand(parts.commandBody)];
  const group = defineGroup({
    name: 'shapes',
    description: 'Shapes',
    endpoints: [echo],
    events,
    commands,
  } as never);
  return defineContract({ name: 'shapes-service', groups: [group] });
}

function anEvent(body: core.$ZodType) {
  const written = { name: 'OrderCreated', version: 1, visibility: 'internal', body };
  return defineEvent({ ...written, description: 'Created' } as never);
}

function aCommand(body: core.$ZodType) {
  const written = { name: 'ChargeCard', version: 1, body };
  return defineCommand({ ...written, description: 'Charge' } as never);
}

/** What each Definitions root of a row exports beside it. */
const exportedBy = new Map<unknown, Readonly<Record<string, unknown>>>();

/** A Definitions root whose file exports the schemas given. */
function definitionsExporting(schemas: Readonly<Record<string, core.$ZodType>>) {
  const definitions = defineDefinitions({});
  exportedBy.set(definitions, schemas);
  return definitions;
}

function failuresIn(root: unknown) {
  const rootExports = exportedBy.get(root) ?? {};
  const validated = validateContract(root, aRootPackage(root, { rootExports }));
  return validated.kind === 'invalid' ? validated.failures : [];
}

const strictObject = () => z.strictObject({ scope: z.string() });
const endpointAt = ['groups', 'shapes', 'endpoints', 'POST /echo'];
const refusedStrict = {
  kind: 'not-allowed',
  construct: 'z.strictObject()',
  instead: 'z.object(): objects are open',
};

describe('validateContract: a strict object fails wherever it sits', () => {
  test.each([
    [
      'in Input',
      () => contractWith({ input: { body: strictObject() } }),
      [...endpointAt, 'input', 'body'],
    ],
    [
      'in Input, written with .strict()',
      () => contractWith({ input: { body: z.object({ scope: z.string() }).strict() } }),
      [...endpointAt, 'input', 'body'],
    ],
    [
      'in a demand',
      () =>
        contractWith({
          guard: { name: 'gate', description: 'Gate', demands: { query: strictObject() } },
        }),
      ['guards', 'gate', 'demands', 'query'],
    ],
    [
      'in a Context',
      () => contractWith({ guard: { name: 'gate', description: 'Gate', context: strictObject() } }),
      ['guards', 'gate', 'context'],
    ],
    [
      'in a Qualifier',
      () =>
        contractWith({ guard: { name: 'gate', description: 'Gate', qualifier: strictObject() } }),
      ['guards', 'gate', 'qualifier'],
    ],
    [
      'in a Success',
      () => contractWith({ success: { status: 200, body: strictObject() } }),
      [...endpointAt, 'success', 'body'],
    ],
    [
      'in a Rejection body',
      () => contractWith({ rejectionBody: strictObject() }),
      ['rejections', 'DENIED', 'body'],
    ],
    [
      'in a shared schema of a Definitions root',
      () => definitionsExporting({ scope: strictObject() }),
      ['exports', 'scope'],
    ],
  ])('a strict object %s fails with one line naming z.object()', (_position, rootOf, at) => {
    const failures = failuresIn(rootOf());

    expect(failures).toEqual([{ ...refusedStrict, at }]);
  });
});

const keyed = () => z.record(z.enum(['eur']), z.number());
const refusedKeyed = { kind: 'not-allowed', construct: keyedRecord, instead: keyedRecordInstead };
const echoAt = ['groups', 'shapes', 'endpoints', 'POST /echo/{}'];

describe('validateContract: a record keyed by an enum or literal fails wherever it sits', () => {
  test.each([
    [
      'in path params',
      () => contractWith({ path: '/echo/:eur', input: { params: keyed() } as never }),
      [...echoAt, 'input', 'params'],
    ],
    [
      'in query',
      () => contractWith({ input: { query: keyed() } as never }),
      [...endpointAt, 'input', 'query'],
    ],
    [
      'in headers',
      () => contractWith({ input: { headers: keyed() } as never }),
      [...endpointAt, 'input', 'headers'],
    ],
    [
      'in an Input body',
      () => contractWith({ input: { body: keyed() } }),
      [...endpointAt, 'input', 'body'],
    ],
    [
      'in Success headers',
      () => contractWith({ success: { status: 204, headers: keyed() } as never }),
      [...endpointAt, 'success', 'headers'],
    ],
    [
      'in a Success body',
      () => contractWith({ success: { status: 200, body: keyed() } }),
      [...endpointAt, 'success', 'body'],
    ],
    [
      'in a Rejection body',
      () => contractWith({ rejectionBody: keyed() }),
      ['rejections', 'DENIED', 'body'],
    ],
    [
      'in an Event body',
      () => contractWith({ eventBody: keyed() }),
      ['groups', 'shapes', 'events', 'OrderCreated@1', 'body'],
    ],
    [
      'in a Command body',
      () => contractWith({ commandBody: keyed() }),
      ['groups', 'shapes', 'commands', 'ChargeCard@1', 'body'],
    ],
    [
      'in a demand',
      () =>
        contractWith({
          guard: { name: 'gate', description: 'Gate', demands: { query: keyed() } } as never,
        }),
      ['guards', 'gate', 'demands', 'query'],
    ],
    [
      'in a Context',
      () => contractWith({ guard: { name: 'gate', description: 'Gate', context: keyed() } }),
      ['guards', 'gate', 'context'],
    ],
    [
      'in a Qualifier',
      () => contractWith({ guard: { name: 'gate', description: 'Gate', qualifier: keyed() } }),
      ['guards', 'gate', 'qualifier'],
    ],
    [
      'in a shared schema of a Definitions root',
      () => definitionsExporting({ totals: keyed() }),
      ['exports', 'totals'],
    ],
  ])(
    'a record keyed by an enum %s fails with one line naming z.object()',
    (_position, rootOf, at) => {
      const failures = failuresIn(rootOf());

      expect(failures).toEqual([{ ...refusedKeyed, at }]);
    },
  );

  test('a record keyed by an enum fails nested in a body, where it is written', () => {
    const body = z.object({ totals: z.array(z.object({ byCurrency: keyed() })) });

    const failures = failuresIn(contractWith({ success: { status: 200, body } }));

    const at = [
      ...endpointAt,
      'success',
      'body',
      'fields',
      'totals',
      'items',
      'fields',
      'byCurrency',
    ];
    expect(failures).toEqual([{ ...refusedKeyed, at }]);
  });

  test('a record keyed by an enum in a recursive def fails once, where the walk first meets it', () => {
    const tree = z
      .object({
        totals: keyed(),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const failures = failuresIn(contractWith({ input: { body }, success: { status: 200, body } }));

    const at = [...endpointAt, 'input', 'body', 'fields', 'first', 'fields', 'totals'];
    expect(failures).toEqual([{ ...refusedKeyed, at }]);
  });

  test('a record keyed by a string is allowed wherever one is written', () => {
    const record = () => z.record(z.string(), z.string());
    const parts = {
      input: { body: record() },
      success: { status: 200 as const, body: record() },
      rejectionBody: record(),
      guard: { name: 'gate', description: 'Gate', context: record(), qualifier: record() },
    };

    const failures = failuresIn(contractWith(parts));

    expect(failures).toEqual([]);
  });
});

const optionalField = (name: string) => z.object({ [name]: z.string().optional() });

const protoConstruct = 'a field named __proto__ (zod drops it when parsing)';

/** Where an object sits in a Contract: a Contract with a field of a name there, and where that field is reported. */
const fieldPlaces = [
  {
    place: 'a query param',
    appliesTo: () => true,
    contractOf: (name: string) => contractWith({ input: { query: optionalField(name) } as never }),
    at: (name: string) => [...endpointAt, 'input', 'query', 'fields', name],
  },
  {
    place: 'a header, whose name is lower-case',
    appliesTo: (name: string) => name === name.toLowerCase(),
    contractOf: (name: string) =>
      contractWith({ input: { headers: optionalField(name) } as never }),
    at: (name: string) => [...endpointAt, 'input', 'headers', 'fields', name],
  },
  {
    place: 'a path param, whose name is camelCase',
    appliesTo: (name: string) => /^[a-z][a-zA-Z0-9]*$/.test(name),
    contractOf: (name: string) =>
      contractWith({
        path: `/echo/:${name}`,
        input: { params: z.object({ [name]: z.string() }) } as never,
      }),
    at: (name: string) => [...echoAt, 'input', 'params', 'fields', name],
  },
  {
    place: 'a field of a body',
    appliesTo: () => true,
    contractOf: (name: string) => contractWith({ input: { body: optionalField(name) } }),
    at: (name: string) => [...endpointAt, 'input', 'body', 'fields', name],
  },
  {
    place: 'a field of an object nested in a body',
    appliesTo: () => true,
    contractOf: (name: string) =>
      contractWith({
        input: { body: z.object({ outer: z.object({ inner: optionalField(name) }) }) },
      }),
    at: (name: string) => [
      ...endpointAt,
      'input',
      'body',
      'fields',
      'outer',
      'fields',
      'inner',
      'fields',
      name,
    ],
  },
  {
    place: 'a field of an object in the value of a record',
    appliesTo: () => true,
    contractOf: (name: string) =>
      contractWith({ input: { body: z.record(z.string(), optionalField(name)) } }),
    at: (name: string) => [...endpointAt, 'input', 'body', 'value', 'fields', name],
  },
  {
    place: 'a field of a Success body',
    appliesTo: () => true,
    contractOf: (name: string) =>
      contractWith({ success: { status: 200, body: optionalField(name) } }),
    at: (name: string) => [...endpointAt, 'success', 'body', 'fields', name],
  },
  {
    place: 'a field of an Event body',
    appliesTo: () => true,
    contractOf: (name: string) => contractWith({ eventBody: optionalField(name) }),
    at: (name: string) => ['groups', 'shapes', 'events', 'OrderCreated@1', 'body', 'fields', name],
  },
] as const;

/** Every place of the list with every name that can sit there. */
const namedFieldPlaces = fieldPlaces.flatMap((place) =>
  inheritedNames.filter(place.appliesTo).map((name) => ({ ...place, name })),
);

describe('validateContract: a field named what every object already has fails wherever it sits', () => {
  test.each(namedFieldPlaces)('$place named $name fails generate', ({ contractOf, at, name }) => {
    const failures = failuresIn(contractOf(name));

    const construct = name === '__proto__' ? protoConstruct : everyObjectHas(name);
    expect(failures).toEqual([{ kind: 'not-allowed', at: at(name), construct }]);
  });
});
