import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import { z as z3 } from 'zod/v3';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { type DefTypes, type Step, walkSchemas } from '../internal/index.ts';

/** The steps down the named parts of an Endpoint, as the Check names them. */
function partsOf(...names: readonly ('input' | 'success' | 'body')[]): readonly Step[] {
  return names.map((name) => ({ kind: 'part', name }));
}

function noOrigin() {
  return undefined;
}

function exportAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
}

function endpointAt(identity: string, name: string, steps: readonly Step[]) {
  const site = { kind: 'endpoint', identity, name } as const;
  return { site, declaration: undefined, steps };
}

function walkedAs(value: unknown) {
  return { kind: 'walked', value };
}

describe('walkSchemas', () => {
  test('every location walks on its own: one that fails hides nothing of the others', () => {
    const order = z.object({ placedAt: z.date(), tags: z.array(z.string().trim()) });
    const inputAt = endpointAt('POST /orders', 'createOrder', partsOf('input', 'body'));
    const successAt = endpointAt('POST /orders', 'createOrder', partsOf('success', 'body'));
    const listedAt = endpointAt('GET /orders', 'listOrders', partsOf('success', 'body'));

    const walked = walkSchemas(
      [
        { at: inputAt, schema: order },
        { at: successAt, schema: z.any() },
        { at: listedAt, schema: z.array(z.uuid()) },
      ],
      noOrigin,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        {
          kind: 'not-allowed',
          failures: [
            {
              kind: 'not-allowed',
              at: 'input.body.placedAt',
              construct: 'z.date()',
              instead: 'z.iso.datetime()',
            },
            {
              kind: 'not-allowed',
              at: 'input.body.tags[]',
              construct:
                '.trim(), .toLowerCase(), .toUpperCase(), .normalize(), .slugify() or .overwrite()',
            },
          ],
        },
        {
          kind: 'not-allowed',
          failures: [
            {
              kind: 'not-allowed',
              at: 'success.body',
              construct: 'z.any()',
              instead: 'z.record() or z.json()',
            },
          ],
        },
        walkedAs({ type: 'array', items: { type: 'string', format: 'uuid' } }),
      ],
      defs: {},
    });
    expect(walked.located.map(({ at }) => at)).toEqual([inputAt, successAt, listedAt]);
  });

  test('the same schema at two locations walks to equal nodes', () => {
    const money = z.object({ amount: z.int(), currency: z.enum(['usd', 'eur']) });

    const walked = walkSchemas(
      [
        { at: exportAt('body'), schema: money },
        { at: exportAt('success'), schema: money },
      ],
      noOrigin,
    );

    const moneyNode = {
      type: 'object',
      fields: {
        amount: { required: true, schema: { type: 'number', int: true } },
        currency: { required: true, schema: { type: 'enum', values: ['eur', 'usd'], open: false } },
      },
    };
    expect(refusalsOf(walked)).toEqual({
      located: [walkedAs(moneyNode), walkedAs(moneyNode)],
      defs: {},
    });
  });

  test('enum values and allOf items are in canonical order', () => {
    const status = z.enum(['shipped', 'paid', 'pending']);
    const code = z.intersection(z.string().regex(/^[A-Z]/), z.string().max(8));

    const walked = walkSchemas(
      [
        { at: exportAt('status'), schema: status },
        { at: exportAt('code'), schema: code },
      ],
      noOrigin,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        walkedAs({ type: 'enum', values: ['paid', 'pending', 'shipped'], open: false }),
        walkedAs({
          type: 'allOf',
          items: [
            { type: 'string', max: 8 },
            { type: 'string', regex: { source: '^[A-Z]', flags: '' } },
          ],
        }),
      ],
      defs: {},
    });
  });

  test('a check without a constructor is a zod this walker does not support, a bug to report', () => {
    const name = z.string().min(1);
    const [check] = name._zod.def.checks ?? [];
    Reflect.deleteProperty(check?._zod ?? {}, 'constr');

    expect(() => walkSchemas([{ at: exportAt('body'), schema: name }], noOrigin)).toThrow(
      /newer than cf-loom supports/,
    );
  });
});

describe('walkSchemas: a value that is no zod 4 schema', () => {
  const notZod4 = 'a value that is no zod 4 schema (zod/v3 is not read)';

  function walkBody(schema: unknown) {
    return refusalsOf(
      walkSchemas([{ at: exportAt('body'), schema: schema as core.$ZodType }], noOrigin),
    );
  }

  function refusedAt(at: string) {
    const failure = { kind: 'not-allowed', at, construct: notZod4 };
    return { located: [{ kind: 'not-allowed', failures: [failure] }], defs: {} };
  }

  test('an object field holding a zod/v3 schema is refused at that field', () => {
    const order = z.object({ id: z.string(), total: z3.number() });

    expect(walkBody(order)).toEqual(refusedAt('total'));
  });

  test.each([
    { what: 'an array of {}', schema: () => z.array({} as never), at: '[]' },
    {
      what: 'a union option null',
      schema: () => z.union([z.string(), null as never]),
      at: '<|1>',
    },
    {
      what: 'a lazy returning a zod/v3 schema',
      schema: () => z.lazy(() => z3.string() as never),
      at: '',
    },
    {
      what: 'a catchall of zod/v3',
      schema: () => z.object({ id: z.string() }).catchall(z3.string() as never),
      at: '',
    },
    {
      what: 'a discriminated union variant that is a lazy of zod/v3',
      schema: () =>
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a') }),
          z.lazy(() => z3.object({ kind: z3.literal('b') })) as never,
        ]),
      at: '<|1>',
    },
    {
      what: 'a discriminated union variant whose discriminator is a lazy of zod/v3',
      schema: () =>
        z.discriminatedUnion('kind', [z.object({ kind: z.lazy(() => z3.literal('b')) as never })]),
      at: '<|0>.kind',
    },
    {
      what: 'a field’s .optional() of zod/v3',
      schema: () => z.object({ id: z.optional(z3.string() as never) }),
      at: 'id',
    },
    {
      what: 'a .default() of zod/v3',
      schema: () => z.object({ id: z._default(z3.string() as never, 'a' as never) }),
      at: 'id',
      beside: '.default()',
    },
  ])('$what is refused at its step', ({ schema, at, beside }) => {
    const walked = walkBody(schema());

    const refusal = { kind: 'not-allowed', at, construct: notZod4 };
    const besideIt = beside === undefined ? [] : [{ kind: 'not-allowed', at, construct: beside }];
    expect(walked).toEqual({
      located: [{ kind: 'not-allowed', failures: expect.arrayContaining([refusal, ...besideIt]) }],
      defs: {},
    });
    expect(walked.located[0]).toMatchObject({ failures: { length: 1 + besideIt.length } });
  });

  test('a zod/mini child still walks', () => {
    expect(walkBody(z.object({ id: zm.string() }))).toEqual({
      located: [
        walkedAs({
          type: 'object',
          fields: { id: { required: true, schema: { type: 'string' } } },
        }),
      ],
      defs: {},
    });
  });

  /** Each child slot of a walked def type, as `defTypes` lists them, and the step a child there sits at. */
  const slots: Record<
    ChildSlot,
    { readonly holding: (child: never) => unknown; readonly at: string }
  > = {
    'object.shape': { holding: (child) => z.object({ f: child }), at: 'f' },
    'record.keyType': { holding: (child) => z.record(child, z.string()), at: '{key}' },
    'record.valueType': {
      holding: (child) =>
        new z.ZodRecord({ type: 'record', keyType: z.string(), valueType: child }),
      at: '{}',
    },
    'array.element': { holding: (child) => z.array(child), at: '[]' },
    'tuple.items': { holding: (child) => z.tuple([z.string(), child]), at: '[1]' },
    'tuple.rest': {
      holding: (child) => new z.ZodTuple({ type: 'tuple', items: [z.string()], rest: child }),
      at: '[...]',
    },
    'union.options': { holding: (child) => z.union([z.string(), child]), at: '<|1>' },
    'intersection.left': { holding: (child) => z.intersection(child, z.string()), at: '[0]' },
    'intersection.right': { holding: (child) => z.intersection(z.string(), child), at: '[1]' },
    'lazy.getter': { holding: (child) => z.lazy(() => child), at: '' },
    'nullable.innerType': { holding: (child) => z.nullable(child), at: '' },
  };

  const values = [
    { what: 'a zod/v3 schema', value: () => z3.string() },
    { what: '{}', value: () => ({}) },
    { what: 'null', value: () => null },
    { what: 'undefined', value: () => undefined },
    { what: '5', value: () => 5 },
  ];

  /** A tuple's `rest` of `null` is zod's own way to say it has none. */
  const cases = Object.entries(slots)
    .flatMap(([slot, { holding, at }]) =>
      values.map(({ what, value }) => ({
        slot,
        what,
        at,
        schema: () => holding(value() as never),
      })),
    )
    .filter(({ slot, what }) => !(slot === 'tuple.rest' && what === 'null'));

  test.each(cases)(
    '$what in the slot $slot is one refusal at its step, never a throw',
    ({ schema, at }) => {
      expect(walkBody(schema())).toEqual(refusedAt(at));
    },
  );
});

/** Each key of a walked def type the table lists, as `<def type>.<key>`: what lies under it is walked. */
type ChildSlot = {
  [Type in keyof DefTypes]: DefTypes[Type] extends {
    readonly walks: readonly (infer Key extends string)[];
  }
    ? `${Type}.${Key}`
    : DefTypes[Type] extends { readonly fields: infer Key extends string }
      ? `${Type}.${Key}`
      : never;
}[keyof DefTypes];
