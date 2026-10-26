import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { aRootPackage } from '../../test/root-package.ts';
import {
  type Contract,
  defineCommand,
  defineContract,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  type Event,
  openEnum,
  openEnumReader,
} from '../index.ts';
import { type Refusal, validateContract } from '../internal/index.ts';

const createOrder = {
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Creates an order',
  success: { status: 201, body: z.object({ id: z.uuid() }) },
} as const;

const listOrders = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.object({ id: z.uuid() }) },
} as const;

const base = {
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
} as const;

const chargeCard = {
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
} as const;

const apiKey = {
  name: 'apiKey',
  description: 'An API key per Caller',
} as const;

function failuresOf(root: Contract) {
  const validated = validateContract(root, aRootPackage(root));
  return validated.kind === 'invalid' ? validated.failures : [];
}

function failuresOfEndpoint(endpoint: Endpoint) {
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return failuresOf(defineContract({ name: 'orders-service', groups: [group] }));
}

function failuresOfEvent(event: Event) {
  const group = defineGroup({ name: 'orders', description: 'Orders', events: [event] });
  return failuresOf(defineContract({ name: 'orders-service', groups: [group] }));
}

describe('schema types in every declaration', () => {
  test('a .default() in an Endpoint’s Input body is a type error naming it', () => {
    const written = {
      ...createOrder,
      input: { body: z.object({ total: z.number().default(0) }) },
    } as const;
    type Slot = Parameters<typeof defineEndpoint<typeof written>>[0]['input']['body'];

    // @ts-expect-error a Contract declares no defaults
    const declare = () => defineEndpoint(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: .default()'>>();
  });

  test('a z.coerce.number() in an Endpoint’s query is a type error naming it', () => {
    const written = {
      ...listOrders,
      input: { query: z.object({ page: z.coerce.number() }) },
    } as const;
    type Slot = Parameters<typeof defineEndpoint<typeof written>>[0]['input']['query'];

    // @ts-expect-error a Contract declares no coercion
    const declare = () => defineEndpoint(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.coerce.*'>>();
  });

  test('a z.date() in a Success body is a type error, and generate names z.iso.datetime() for it', () => {
    const written = {
      ...listOrders,
      success: { status: 200, body: z.object({ placedAt: z.date() }) },
    } as const;
    type Slot = Parameters<typeof defineEndpoint<typeof written>>[0]['success']['body'];

    // @ts-expect-error a date travels as a string
    const endpoint = defineEndpoint(written);

    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.date() (use z.iso.datetime())'>>();
    expect(failuresOfEndpoint(endpoint)).toEqual([
      expect.objectContaining({
        kind: 'not-allowed',
        construct: 'z.date()',
        instead: 'z.iso.datetime()',
      }),
    ]);
  });

  test('a z.map() in Success headers is a type error naming it', () => {
    const written = {
      ...listOrders,
      success: {
        status: 200,
        headers: z.object({ 'x-totals': z.map(z.string(), z.string()) }),
        body: z.object({ id: z.uuid() }),
      },
    } as const;
    type Slot = Parameters<typeof defineEndpoint<typeof written>>[0]['success']['headers'];

    // @ts-expect-error a Map is not JSON
    const declare = () => defineEndpoint(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.map()'>>();
  });

  test('a .transform() in an Event’s body is a type error naming it', () => {
    const written = { ...base, body: z.object({ total: z.string().transform(Number) }) } as const;
    type Slot = Parameters<typeof defineEvent<typeof written>>[0]['body'];

    // @ts-expect-error what a transform produces is not what travels
    const declare = () => defineEvent(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: .transform()'>>();
  });

  test('a zod/mini default in a Command’s body is a type error naming it', () => {
    const written = {
      ...chargeCard,
      body: zm.object({ total: zm._default(zm.number(), 1) }),
    } as const;
    type Slot = Parameters<typeof defineCommand<typeof written>>[0]['body'];

    // @ts-expect-error a Contract declares no defaults, whichever zod it is written with
    const declare = () => defineCommand(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: .default()'>>();
  });

  test('a z.bigint() in a Rejection’s body is a type error naming it', () => {
    const written = {
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'The order can no longer be changed',
      body: z.object({ version: z.bigint() }),
    } as const;
    type Slot = Parameters<typeof defineRejection<typeof written>>[0]['body'];

    // @ts-expect-error a bigint is not JSON
    const declare = () => defineRejection(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.bigint()'>>();
  });

  test('a z.coerce in a Guard’s demanded query is a type error naming it', () => {
    const written = {
      ...apiKey,
      demands: { query: z.object({ page: z.coerce.number() }) },
    } as const;
    type Slot = Parameters<typeof defineGuard<typeof written>>[0]['demands']['query'];

    // @ts-expect-error a Contract declares no coercion
    const declare = () => defineGuard(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.coerce.*'>>();
  });

  test('a z.date() in a Guard’s Context is a type error naming it', () => {
    const written = { ...apiKey, context: z.object({ since: z.date() }) } as const;
    type Slot = Parameters<typeof defineGuard<typeof written>>[0]['context'];

    // @ts-expect-error a date travels as a string
    const declare = () => defineGuard(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.date() (use z.iso.datetime())'>>();
  });

  test('a .default() in a Guard’s Qualifier is a type error naming it', () => {
    const written = {
      ...apiKey,
      qualifier: z.object({ scope: z.string().default('all') }),
    } as const;
    type Slot = Parameters<typeof defineGuard<typeof written>>[0]['qualifier'];

    // @ts-expect-error a Contract declares no defaults
    const declare = () => defineGuard(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: .default()'>>();
  });

  test('a refused construct inside an array of objects is a type error naming it', () => {
    const written = {
      ...listOrders,
      success: { status: 200, body: z.array(z.object({ placedAt: z.date() })) },
    } as const;
    type Slot = Parameters<typeof defineEndpoint<typeof written>>[0]['success']['body'];

    // @ts-expect-error a date travels as a string
    const declare = () => defineEndpoint(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.date() (use z.iso.datetime())'>>();
  });

  test('a z.null() as a union option is a type error, and inside z.json() it is not', () => {
    const written = { ...base, body: z.object({ f: z.union([z.string(), z.null()]) }) } as const;
    type Slot = Parameters<typeof defineEvent<typeof written>>[0]['body'];

    // @ts-expect-error null is written .nullable()
    const declare = () => defineEvent(written);
    const json = defineEvent({ ...base, body: z.object({ f: z.json() }) });

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.null() (use .nullable())'>>();
    expect(json.kind).toBe('event');
  });

  test('a refused construct at the tenth schema is a type error, and at the eleventh it is left to generate', () => {
    const tenth = defineEvent({
      ...base,
      // @ts-expect-error a date travels as a string
      body: aDateAtTheTenthSchema,
    });
    const eleventh = defineEvent({ ...base, body: aDateAtTheEleventhSchema });

    expect(failuresOfEvent(tenth)).toEqual([
      expect.objectContaining({ kind: 'not-allowed', construct: 'z.date()' }),
    ]);
    expect(failuresOfEvent(eleventh)).toEqual([
      expect.objectContaining({ kind: 'not-allowed', construct: 'z.date()' }),
    ]);
  });

  test('openEnumReader in an author’s Endpoint is a type error naming z.codec(), and generate refuses it', () => {
    const written = {
      ...listOrders,
      success: { status: 200, body: z.object({ stage: openEnumReader(['packed']) }) },
    } as const;
    type Slot = Parameters<typeof defineEndpoint<typeof written>>[0]['success']['body'];

    // @ts-expect-error a Reader schema belongs to a Contract Package, built with providedEndpoint
    const endpoint = defineEndpoint(written);

    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.codec()'>>();
    expect(failuresOfEndpoint(endpoint)).toContainEqual(
      expect.objectContaining({ kind: 'not-allowed', construct: 'z.codec()' }),
    );
  });

  test('a refused construct as an Event’s whole body is one type error naming it, without the Message body rule’s', () => {
    const written = { ...base, body: z.date() } as const;
    type Slot = Parameters<typeof defineEvent<typeof written>>[0]['body'];

    // @ts-expect-error a date travels as a string
    const event = defineEvent(written);

    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.date() (use z.iso.datetime())'>>();
    expectTypeOf<Slot>().not.toExtend<Refusal<'A Message body is an object of its fields'>>();
    expect(failuresOfEvent(event)).toEqual([
      expect.objectContaining({ kind: 'not-allowed', construct: 'z.date()' }),
    ]);
  });

  test('a refused construct as a Command’s whole body is one type error naming it, without the Message body rule’s', () => {
    const written = { ...chargeCard, body: z.date() } as const;
    type Slot = Parameters<typeof defineCommand<typeof written>>[0]['body'];

    // @ts-expect-error a date travels as a string
    const declare = () => defineCommand(written);

    expect(declare).not.toThrow();
    expectTypeOf<Slot>().toExtend<Refusal<'not allowed: z.date() (use z.iso.datetime())'>>();
    expectTypeOf<Slot>().not.toExtend<Refusal<'A Message body is an object of its fields'>>();
  });
});

type DefType = core.$ZodTypes['_zod']['def']['type'];

/** What the types do with each zod def type: walk through it and judge what it holds, or refuse it. */
const treatment = {
  string: 'walked',
  number: 'walked',
  boolean: 'walked',
  literal: 'walked',
  enum: 'walked',
  object: 'walked',
  record: 'walked',
  array: 'walked',
  tuple: 'walked',
  union: 'walked',
  intersection: 'walked',
  lazy: 'walked',
  nullable: 'walked',
  optional: 'walked',
  nonoptional: 'walked',
  default: 'refused',
  prefault: 'refused',
  catch: 'refused',
  readonly: 'refused',
  transform: 'refused',
  pipe: 'refused',
  custom: 'refused',
  date: 'refused',
  null: 'refused',
  undefined: 'refused',
  any: 'refused',
  unknown: 'refused',
  bigint: 'refused',
  symbol: 'refused',
  void: 'refused',
  never: 'refused',
  nan: 'refused',
  map: 'refused',
  set: 'refused',
  file: 'refused',
  promise: 'refused',
  function: 'refused',
  success: 'refused',
  // biome-ignore lint/style/useNamingConvention: zod's name of the def type
  template_literal: 'refused',
} as const satisfies Record<DefType, 'walked' | 'refused'>;

type DefTypeThatIs<Kind> = {
  [Type in DefType]: (typeof treatment)[Type] extends Kind ? Type : never;
}[DefType];

/** An Event declared with one schema as a field of its body, and what `generate` says of it. */
type Row = { readonly name: string; readonly event: () => Event };

/** A schema that holds a refused construct, and the construct as the Not allowed list names it. */
type RefusedRow = { readonly name: string; readonly schema: core.$ZodType };

/** Each refused def type has rows. */
const aCodec = z.codec(z.string(), z.number(), { decode: Number, encode: String });
const aTemplateLiteral = z.templateLiteral([z.string(), '-', z.number()]);

const refusedRows = {
  default: [
    { name: '.default()', schema: z.object({ f: z.string().default('a') }) },
    { name: '.default()', schema: z.object({ f: zm._default(zm.string(), 'a') }) },
  ],
  prefault: [{ name: '.prefault()', schema: z.object({ f: z.string().prefault('a') }) }],
  catch: [{ name: '.catch()', schema: z.object({ f: z.string().catch('a') }) }],
  readonly: [{ name: '.readonly()', schema: z.object({ f: z.object({}).readonly() }) }],
  transform: [{ name: '.transform()', schema: z.object({ f: z.transform((text) => text) }) }],
  pipe: [
    { name: '.transform()', schema: z.object({ f: z.string().transform(Number) }) },
    { name: '.preprocess()', schema: z.object({ f: z.preprocess(String, z.string()) }) },
    { name: '.pipe()', schema: z.object({ f: z.string().pipe(z.string()) }) },
    { name: 'z.codec()', schema: z.object({ f: aCodec }) },
    { name: 'z.stringbool()', schema: z.object({ f: z.stringbool() }) },
    { name: 'z.codec()', schema: z.object({ f: openEnumReader(['a']) }) },
  ],
  custom: [{ name: 'z.custom()', schema: z.object({ f: z.custom<string>() }) }],
  date: [
    { name: 'z.date()', schema: z.object({ f: z.date() }) },
    { name: 'z.date()', schema: z.object({ f: z.coerce.date() }) },
  ],
  null: [
    { name: 'z.null()', schema: z.object({ f: z.null() }) },
    { name: 'z.null()', schema: z.object({ f: z.union([z.string(), z.null()]) }) },
  ],
  undefined: [{ name: 'z.undefined()', schema: z.object({ f: z.undefined() }) }],
  any: [{ name: 'z.any()', schema: z.object({ f: z.any() }) }],
  unknown: [{ name: 'z.unknown()', schema: z.object({ f: z.unknown() }) }],
  bigint: [
    { name: 'z.bigint()', schema: z.object({ f: z.bigint() }) },
    { name: 'z.bigint()', schema: z.object({ f: z.coerce.bigint() }) },
  ],
  symbol: [{ name: 'z.symbol()', schema: z.object({ f: z.symbol() }) }],
  void: [{ name: 'z.void()', schema: z.object({ f: z.void() }) }],
  never: [{ name: 'z.never()', schema: z.object({ f: z.never() }) }],
  nan: [{ name: 'z.nan()', schema: z.object({ f: z.nan() }) }],
  map: [{ name: 'z.map()', schema: z.object({ f: z.map(z.string(), z.string()) }) }],
  set: [{ name: 'z.set()', schema: z.object({ f: z.set(z.string()) }) }],
  file: [{ name: 'z.file()', schema: z.object({ f: z.file() }) }],
  promise: [{ name: 'z.promise()', schema: z.object({ f: z.promise(z.string()) }) }],
  function: [{ name: 'z.function()', schema: z.object({ f: z.function() }) }],
  success: [{ name: 'z.success()', schema: z.object({ f: z.success(z.string()) }) }],
  // biome-ignore lint/style/useNamingConvention: zod's name of the def type
  template_literal: [{ name: 'z.templateLiteral()', schema: z.object({ f: aTemplateLiteral }) }],
} as const satisfies Record<DefTypeThatIs<'refused'>, readonly RefusedRow[]>;

/** Refused beside their def type, which is otherwise walked: coercion and a catchall of a typed schema or `z.any()`. */
const refusedBesideRows = [
  { name: 'z.coerce.*', schema: z.object({ f: z.coerce.string() }) },
  { name: 'z.coerce.*', schema: z.object({ f: z.coerce.number() }) },
  { name: 'z.coerce.*', schema: z.object({ f: z.coerce.boolean() }) },
  { name: 'z.coerce.*', schema: z.object({ f: zm.coerce.number() }) },
  { name: '.catchall()', schema: z.object({ f: z.object({}).catchall(z.string()) }) },
  { name: '.catchall()', schema: z.object({ f: z.object({}).catchall(z.any()) }) },
  { name: '.catchall()', schema: z.object({ f: zm.catchall(zm.object({}), zm.string()) }) },
] as const satisfies readonly RefusedRow[];

/** A refused construct inside each kind of schema the types walk, so the walk drops none. */
const refusedInsideRows = [
  { name: 'z.date()', schema: z.object({ f: z.object({ at: z.date() }) }) },
  { name: 'z.date()', schema: z.object({ f: z.array(z.date()) }) },
  { name: 'z.date()', schema: z.object({ f: z.union([z.string(), z.date()]) }) },
  {
    name: 'z.date()',
    schema: z.object({
      f: z.discriminatedUnion('kind', [z.object({ kind: z.literal('a'), at: z.date() })]),
    }),
  },
  { name: 'z.date()', schema: z.object({ f: z.record(z.string(), z.date()) }) },
  {
    name: '.transform()',
    schema: z.object({
      f: z.record(
        z.string().transform((text) => text),
        z.string(),
      ),
    }),
  },
  { name: 'z.date()', schema: z.object({ f: z.tuple([z.date()]) }) },
  { name: 'z.date()', schema: z.object({ f: z.tuple([z.string()], z.date()) }) },
  {
    name: 'z.date()',
    schema: z.object({ f: z.intersection(z.object({ a: z.date() }), z.object({ b: z.string() })) }),
  },
  {
    name: 'z.date()',
    schema: z.object({ f: z.intersection(z.object({ a: z.string() }), z.object({ b: z.date() })) }),
  },
  { name: 'z.date()', schema: z.object({ f: z.lazy(() => z.date()) }) },
  { name: 'z.date()', schema: z.object({ f: z.date().nullable() }) },
  { name: 'z.date()', schema: z.object({ f: z.date().optional() }) },
  { name: 'z.date()', schema: z.object({ f: z.date().optional().nonoptional() }) },
] as const satisfies readonly RefusedRow[];

type RefusedRows =
  | (typeof refusedRows)[keyof typeof refusedRows][number]
  | (typeof refusedBesideRows)[number]
  | (typeof refusedInsideRows)[number];

/** What an Event's body is judged by, as the editor reads it, when its body is one schema. */
type BodyOf<Schema extends core.$ZodType> = Parameters<
  typeof defineEvent<{
    readonly name: 'Probed';
    readonly version: 1;
    readonly visibility: 'internal';
    readonly description: 'Probed';
    readonly body: Schema;
  }>
>[0]['body'];

/** The sentences of a body's type error that say `not allowed`. */
type RefusalsOf<Schema extends core.$ZodType> = Extract<
  keyof BodyOf<Schema>,
  `not allowed: ${string}`
>;

/** Whether a row's type error names exactly the construct the row names, as `generate` does. */
type NamesItsConstruct<Row extends RefusedRow> = [RefusalsOf<Row['schema']>] extends [never]
  ? false
  : [RefusalsOf<Row['schema']>] extends [
        `not allowed: ${Row['name']}` | `not allowed: ${Row['name']} (use ${string})`,
      ]
    ? true
    : false;

/** The names of the rows whose type error is missing, or names another construct. */
type Misnamed<Row extends RefusedRow> = Row extends unknown
  ? NamesItsConstruct<Row> extends true
    ? never
    : Row['name']
  : never;

describe('every construct the types refuse', () => {
  test('each type error names the construct its row names, and no row is left without one', () => {
    expectTypeOf<Misnamed<RefusedRows>>().toEqualTypeOf<never>();
  });

  test.each([
    ...Object.values(refusedRows).flat(),
    ...refusedBesideRows,
    ...refusedInsideRows,
  ] as readonly RefusedRow[])(
    '$name fails generate with the construct its type error names',
    ({ name, schema }) => {
      const body: Parameters<typeof defineEvent>[0] = { ...base, body: schema };
      const failures = failuresOfEvent(defineEvent(body));

      expect(failures).toContainEqual(
        expect.objectContaining({ kind: 'not-allowed', construct: name }),
      );
    },
  );
});

type Category = { readonly name: string; readonly children: readonly Category[] };
const category = z
  .object({
    name: z.string(),
    get children(): z.ZodArray<z.ZodType<Category>> {
      return z.array(category);
    },
  })
  .meta({ id: 'category' });
const annotatedLazy: z.ZodType<string> = z.lazy(() => z.string()).meta({ description: 'text' });

/** Each walked def type has rows, none refused by the types and each accepted by `generate`. */
const walkedRows: Record<DefTypeThatIs<'walked'>, readonly Row[]> = {
  string: [
    {
      name: 'z.string()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.string() }) }),
    },
    { name: 'z.uuid()', event: () => defineEvent({ ...base, body: z.object({ f: z.uuid() }) }) },
    {
      name: 'z.iso.datetime()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.iso.datetime() }) }),
    },
    {
      name: 'a bounded string',
      event: () => defineEvent({ ...base, body: z.object({ f: z.string().min(1).max(9) }) }),
    },
    {
      name: 'a branded string',
      event: () => defineEvent({ ...base, body: z.object({ f: z.string().brand<'OrderId'>() }) }),
    },
  ],
  number: [
    {
      name: 'z.number()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.number() }) }),
    },
    { name: 'z.int()', event: () => defineEvent({ ...base, body: z.object({ f: z.int() }) }) },
  ],
  boolean: [
    {
      name: 'z.boolean()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.boolean() }) }),
    },
  ],
  literal: [
    {
      name: 'z.literal()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.literal('a') }) }),
    },
  ],
  enum: [
    {
      name: 'z.enum()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.enum(['a', 'b']) }) }),
    },
    {
      name: 'openEnum()',
      event: () => defineEvent({ ...base, body: z.object({ f: openEnum(['a', 'b']) }) }),
    },
  ],
  object: [
    {
      name: 'z.object()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.object({ a: z.string() }) }) }),
    },
  ],
  record: [
    {
      name: 'z.record()',
      event: () =>
        defineEvent({ ...base, body: z.object({ f: z.record(z.string(), z.number()) }) }),
    },
  ],
  array: [
    {
      name: 'z.array()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.array(z.string()) }) }),
    },
  ],
  tuple: [
    {
      name: 'z.tuple()',
      event: () =>
        defineEvent({ ...base, body: z.object({ f: z.tuple([z.string(), z.number()]) }) }),
    },
  ],
  union: [
    {
      name: 'z.union()',
      event: () =>
        defineEvent({ ...base, body: z.object({ f: z.union([z.string(), z.number()]) }) }),
    },
    {
      name: 'z.discriminatedUnion()',
      event: () => defineEvent({ ...base, body: z.object({ f: aDiscriminatedUnion }) }),
    },
    {
      name: 'z.json(), which holds z.null()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.json() }) }),
    },
  ],
  intersection: [
    {
      name: 'z.intersection()',
      event: () => defineEvent({ ...base, body: z.object({ f: anIntersection }) }),
    },
  ],
  lazy: [
    {
      name: 'a recursive schema with .meta({ id })',
      event: () => defineEvent({ ...base, body: category }),
    },
    {
      name: 'a z.lazy() annotated',
      event: () => defineEvent({ ...base, body: z.object({ f: annotatedLazy }) }),
    },
  ],
  nullable: [
    {
      name: '.nullable()',
      event: () => defineEvent({ ...base, body: z.object({ f: z.string().nullable() }) }),
    },
  ],
  optional: [
    {
      name: '.optional() on a field',
      event: () => defineEvent({ ...base, body: z.object({ f: z.string().optional() }) }),
    },
  ],
  nonoptional: [
    {
      name: '.nonoptional() on a field',
      event: () =>
        defineEvent({ ...base, body: z.object({ f: z.string().optional().nonoptional() }) }),
    },
  ],
};

const aDiscriminatedUnion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('a') }),
  z.object({ kind: z.literal('b') }),
]);
const anIntersection = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));

describe('every schema generate maps', () => {
  test.each(Object.values(walkedRows).flat())(
    '$name compiles in a declaration and passes generate',
    ({ event }) => {
      const failures = failuresOfEvent(event());

      expect(failures).toEqual([]);
    },
  );
});

describe('what the types leave to generate', () => {
  test('.refine(), z.strictObject() and z.looseObject() compile, and generate refuses them', () => {
    const refined = defineEvent({
      ...base,
      body: z.object({ f: z.string().refine((text) => text.length > 0) }),
    });
    const strict = defineEvent({
      ...base,
      body: z.object({ f: z.strictObject({ a: z.string() }) }),
    });
    const loose = defineEvent({ ...base, body: z.object({ f: z.looseObject({ a: z.string() }) }) });

    expect([refined, strict, loose].map((event) => failuresOfEvent(event)[0]?.kind)).toEqual([
      'not-allowed',
      'not-allowed',
      'not-allowed',
    ]);
  });

  test('a schema typed z.ZodType<T> or core.$ZodType compiles', () => {
    const typed: z.ZodType<string> = z.string();
    const untyped: core.$ZodType = z.string();

    const event = defineEvent({ ...base, body: z.object({ typed, untyped }) });

    expect(event.kind).toBe('event');
  });

  test('a schema typed by a type parameter compiles in a generic function’s declaration', () => {
    function declareStage<Stage extends z.ZodType>(stage: Stage) {
      return defineEndpoint({
        ...listOrders,
        success: { status: 200, body: z.object({ stage }) },
      });
    }

    expect(declareStage(z.string()).kind).toBe('endpoint');
  });
});

/** A body whose only date is its tenth schema: nine objects hold it. */
const aDateAtTheTenthSchema = z.object({
  a: z.object({
    a: z.object({
      a: z.object({
        a: z.object({
          a: z.object({ a: z.object({ a: z.object({ a: z.object({ a: z.date() }) }) }) }),
        }),
      }),
    }),
  }),
});

/** A body whose only date is its eleventh schema: ten objects hold it. */
const aDateAtTheEleventhSchema = z.object({
  a: z.object({
    a: z.object({
      a: z.object({
        a: z.object({
          a: z.object({
            a: z.object({ a: z.object({ a: z.object({ a: z.object({ a: z.date() }) }) }) }),
          }),
        }),
      }),
    }),
  }),
});
