import * as built from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { openEnum } from '../index.ts';
import { type SchemaNode, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  const at = { site: { kind: 'export', name: 'body' }, declaration: undefined, steps: [] } as const;
  return refusalsOf(walkSchemas([{ at, schema }], () => undefined));
}

function walkedTo(node: SchemaNode) {
  return { located: [{ kind: 'walked', value: node }], defs: {} };
}

function refusedAt(at: string, construct: string) {
  const failure = { kind: 'not-allowed', at, construct };
  return { located: [{ kind: 'not-allowed', failures: [failure] }], defs: {} };
}

const card = z.object({ type: z.literal('card'), last4: z.string() });
const transfer = z.object({ type: z.literal('transfer'), iban: z.string() });

const cardNode = {
  type: 'object',
  fields: {
    type: { required: true, schema: { type: 'enum', values: ['card'], open: false } },
    last4: { required: true, schema: { type: 'string' } },
  },
} as const;

const transferNode = {
  type: 'object',
  fields: {
    type: { required: true, schema: { type: 'enum', values: ['transfer'], open: false } },
    iban: { required: true, schema: { type: 'string' } },
  },
} as const;

describe('walkSchemas: enums', () => {
  test('an enum is closed with its values', () => {
    expect(walkBody(z.enum(['pending', 'paid']))).toEqual(
      walkedTo({ type: 'enum', values: ['paid', 'pending'], open: false }),
    );
  });

  test('an enum holds each value once', () => {
    expect(walkBody(z.enum({ first: 'x', second: 'x' }))).toEqual(
      walkedTo({ type: 'enum', values: ['x'], open: false }),
    );
  });

  test('an openEnum is open', () => {
    expect(walkBody(openEnum(['pending', 'paid']))).toEqual(
      walkedTo({ type: 'enum', values: ['paid', 'pending'], open: true }),
    );
  });

  test('a described openEnum stays open', () => {
    const status = openEnum(['pending', 'paid']).describe('The status');

    expect(walkBody(status)).toEqual(
      walkedTo({
        type: 'enum',
        values: ['paid', 'pending'],
        open: true,
        description: 'The status',
      }),
    );
  });

  test('an openEnum from another copy of @cf-loom/contract is open', () => {
    expect(walkBody(built.openEnum(['pending']))).toEqual(
      walkedTo({ type: 'enum', values: ['pending'], open: true }),
    );
  });
});

const declaredOptions = [
  { name: 'a string', schema: z.string(), node: { type: 'string' } },
  {
    name: 'an object',
    schema: z.object({ id: z.string() }),
    node: {
      type: 'object',
      fields: { id: { required: true, schema: { type: 'string' } } },
    },
  },
  {
    name: 'an array',
    schema: z.array(z.number()),
    node: { type: 'array', items: { type: 'number' } },
  },
] as const;

const closedValues = [
  { name: 'a literal d', schema: z.literal('d') },
  { name: 'a literal a', schema: z.literal('a') },
  { name: 'an enum of c and b', schema: z.enum(['c', 'b']) },
] as const;

/** Every order the items can be declared in. */
function ordersOf<Item>(items: readonly Item[]): readonly (readonly Item[])[] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) => {
    const others = items.filter((_, other) => other !== index);
    return ordersOf(others).map((order) => [item, ...order]);
  });
}

function titled<Item extends { readonly name: string }>(order: readonly Item[]) {
  return [order.map(({ name }) => name).join(', then '), order] as const;
}

describe('walkSchemas: unions', () => {
  test.each(ordersOf(declaredOptions).map(titled))(
    'a union of %s keeps that order',
    (_names, options) => {
      const walked = walkBody(z.union(options.map(({ schema }) => schema)));

      expect(walked).toEqual(walkedTo({ type: 'union', options: options.map(({ node }) => node) }));
    },
  );

  test.each(ordersOf(closedValues).map(titled))(
    'a union of %s is one enum with sorted values',
    (_names, options) => {
      const walked = walkBody(z.union(options.map(({ schema }) => schema)));

      expect(walked).toEqual(walkedTo({ type: 'enum', values: ['a', 'b', 'c', 'd'], open: false }));
    },
  );

  test('a union of described literals is an enum, without their descriptions', () => {
    const flag = z.union([z.literal('on').describe('Switched on'), z.literal('off')]);

    expect(walkBody(flag)).toEqual(walkedTo({ type: 'enum', values: ['off', 'on'], open: false }));
  });

  test('a union of literals of one and of several values is one enum', () => {
    const grade = z.union([z.literal(['a', 'b']), z.literal('c')]);

    expect(walkBody(grade)).toEqual(
      walkedTo({ type: 'enum', values: ['a', 'b', 'c'], open: false }),
    );
  });

  test('a union of literals with a nullable one is a nullable enum', () => {
    const flag = z.union([z.literal('on').nullable(), z.literal('off')]);

    expect(walkBody(flag)).toEqual(
      walkedTo({ type: 'enum', values: ['off', 'on'], open: false, nullable: true }),
    );
  });

  test('a union of literals is an enum whose values keep their JSON type', () => {
    const flag = z.union([z.literal('true'), z.literal(true), z.literal(1)]);

    expect(walkBody(flag)).toEqual(
      walkedTo({ type: 'enum', values: ['true', 1, true], open: false }),
    );
  });
});

describe('walkSchemas: discriminated unions', () => {
  test('a discriminated union is a closed tagged node, its variants keyed by canonical JSON', () => {
    expect(walkBody(z.discriminatedUnion('type', [card, transfer]))).toEqual(
      walkedTo({
        type: 'tagged',
        discriminator: 'type',
        variants: { '"card"': cardNode, '"transfer"': transferNode },
      }),
    );
  });

  test('true and "true" are different variants', () => {
    const yes = z.object({ ok: z.literal(true) });
    const quoted = z.object({ ok: z.literal('true') });

    const walked = walkBody(z.discriminatedUnion('ok', [yes, quoted]));

    expect(walked.located[0]).toMatchObject({
      kind: 'walked',
      value: {
        variants: { true: {}, '"true"': {} },
      },
    });
  });

  test('a variant whose discriminator has several values fails', () => {
    const either = z.object({ type: z.literal(['card', 'debit']) });

    expect(walkBody(z.discriminatedUnion('type', [either, transfer]))).toEqual(
      refusedAt('<|0>', 'a discriminated union variant whose discriminator has several values'),
    );
  });

  test('a discriminated union variant whose discriminator is a number is allowed', () => {
    const numbered = z.object({ type: z.literal(1) });

    expect(walkBody(z.discriminatedUnion('type', [card, numbered]))).toMatchObject(
      walkedTo({ type: 'tagged', discriminator: 'type', variants: {} }),
    );
  });

  test('two variants with the same discriminator value fail', () => {
    const otherCard = z.object({ type: z.literal('card'), token: z.string() });

    expect(walkBody(z.discriminatedUnion('type', [card, otherCard]))).toEqual(
      refusedAt('', 'two discriminated union variants with the same discriminator value'),
    );
  });

  test('a variant whose discriminator is not a literal fails', () => {
    const anyType = z.object({ type: z.string() });

    expect(walkBody(z.discriminatedUnion('type', [card, anyType]))).toEqual(
      refusedAt('<|1>', 'a discriminated union variant whose discriminator is not a literal'),
    );
  });

  test('a variant whose discriminator is a one-value enum fails', () => {
    const wire = z.object({ type: z.enum(['wire']) });

    expect(walkBody(z.discriminatedUnion('type', [card, wire]))).toEqual(
      refusedAt(
        '<type="wire">',
        'a discriminated union variant whose discriminator is not a literal',
      ),
    );
  });

  const wire = z.object({ type: z.literal('wire') });
  const notAnObject = 'a discriminated union variant that is not an object';
  const unliteral = 'a discriminated union variant whose discriminator is not a literal';

  test.each([
    {
      what: 'a readonly variant',
      variant: () => z.readonly(wire),
      lines: [
        ['<type="wire">', notAnObject],
        ['<type="wire">', '.readonly()'],
      ],
    },
    {
      what: 'a lazy readonly variant',
      variant: () => z.lazy(() => z.readonly(wire)),
      lines: [
        ['<type="wire">', notAnObject],
        ['<type="wire">', '.readonly()'],
      ],
    },
    {
      what: 'a piped variant',
      variant: () => wire.pipe(z.object({ type: z.literal('wire') })),
      lines: [
        ['<type="wire">', notAnObject],
        ['<type="wire">', '.pipe()'],
      ],
    },
    {
      what: 'a readonly discriminator',
      variant: () => z.object({ type: z.readonly(z.literal('wire')) }),
      lines: [
        ['<type="wire">', unliteral],
        ['<type="wire">.type', '.readonly()'],
      ],
    },
    {
      what: 'a piped discriminator',
      variant: () => z.object({ type: z.literal('wire').pipe(z.literal('wire')) }),
      lines: [
        ['<type="wire">', unliteral],
        ['<type="wire">.type', '.pipe()'],
      ],
    },
    {
      what: 'a lazy one-value enum discriminator, which zod reads no value from',
      variant: () => z.object({ type: z.lazy(() => z.enum(['wire'])) }),
      lines: [['<|1>', unliteral]],
    },
  ])('$what is told by its discriminator value where zod reads one', ({ variant, lines }) => {
    const walked = walkBody(z.discriminatedUnion('type', [card, variant()]));

    expect(walked).toEqual({
      located: [
        {
          kind: 'not-allowed',
          failures: lines.map(([at, construct]) => ({ kind: 'not-allowed', at, construct })),
        },
      ],
      defs: {},
    });
  });

  test('a discriminated union that is a variant of itself through a lazy is told, not looped on', () => {
    const payment: z.ZodType = z.discriminatedUnion('type', [
      z.object({ type: z.literal('card') }),
      z.lazy(() => payment) as never,
    ]);

    const walked = walkBody(payment);

    expect(walked.located[0]).toMatchObject({
      kind: 'not-allowed',
      failures: expect.arrayContaining([
        expect.objectContaining({ construct: 'a discriminated union as a variant of another' }),
      ]),
    });
  });

  test('a discriminated union as a variant of another fails', () => {
    const nested = z.discriminatedUnion('kind', [
      z.object({ type: z.literal('wallet'), kind: z.literal('crypto') }),
    ]);

    expect(walkBody(z.discriminatedUnion('type', [card, nested]))).toEqual(
      refusedAt('<type="wallet">', 'a discriminated union as a variant of another'),
    );
  });

  test.each([
    [
      'an intersection',
      z.intersection(z.object({ type: z.literal('wire') }), z.object({ iban: z.string() })),
    ],
    [
      'a union',
      z.union([z.object({ type: z.literal('wire') }), z.object({ type: z.literal('sepa') })]),
    ],
    ['a nullable object', z.object({ type: z.literal('wire') }).nullable()],
  ])('%s as a variant fails, as zod rejects it', (_name, variant) => {
    const variants = [card, variant] as unknown as [typeof card];

    expect(walkBody(z.discriminatedUnion('type', variants))).toEqual(
      refusedAt('<|1>', 'a discriminated union variant that is not an object'),
    );
  });
});

describe('walkSchemas: choices without options', () => {
  test('a discriminated union without options fails by that name', () => {
    const schema = z.discriminatedUnion('type', [] as unknown as [typeof card]);

    expect(walkBody(schema)).toEqual(refusedAt('', 'a z.discriminatedUnion() without options'));
  });

  test('a union without options fails as a union, not as an enum', () => {
    const schema = z.union([] as unknown as [typeof card]);

    expect(walkBody(schema)).toEqual(refusedAt('', 'a z.union() without options'));
  });
});
