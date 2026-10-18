import * as built from '@casitafeliz/loom-contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { openEnum, openUnion } from '../index.ts';
import { type SchemaNode, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function walkedTo(node: SchemaNode) {
  return { kind: 'walked', nodes: [node], defs: {} };
}

function refusedAt(at: readonly (string | number)[], construct: string) {
  return { kind: 'not-allowed', failures: [{ at, construct }] };
}

const card = z.object({ type: z.literal('card'), last4: z.string() });
const transfer = z.object({ type: z.literal('transfer'), iban: z.string() });

const cardNode = {
  type: 'object',
  mode: 'open',
  fields: {
    type: { required: true, schema: { type: 'literal', value: 'card' } },
    last4: { required: true, schema: { type: 'string' } },
  },
} as const;

const transferNode = {
  type: 'object',
  mode: 'open',
  fields: {
    type: { required: true, schema: { type: 'literal', value: 'transfer' } },
    iban: { required: true, schema: { type: 'string' } },
  },
} as const;

describe('walkSchemas: enums', () => {
  test('an enum is closed with its values', () => {
    expect(walkBody(z.enum(['pending', 'paid']))).toEqual(
      walkedTo({ type: 'enum', values: ['paid', 'pending'], open: false }),
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

  test('an openEnum from another copy of loom-contract is open', () => {
    expect(walkBody(built.openEnum(['pending']))).toEqual(
      walkedTo({ type: 'enum', values: ['pending'], open: true }),
    );
  });
});

describe('walkSchemas: unions', () => {
  test('a union holds its options', () => {
    expect(walkBody(z.union([z.string(), z.number()]))).toEqual(
      walkedTo({ type: 'union', options: [{ type: 'number' }, { type: 'string' }] }),
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
  test('a discriminated union is tagged, its variants keyed by canonical JSON', () => {
    expect(walkBody(z.discriminatedUnion('type', [card, transfer]))).toEqual(
      walkedTo({
        type: 'tagged',
        discriminator: 'type',
        variants: { '"card"': cardNode, '"transfer"': transferNode },
        open: false,
      }),
    );
  });

  test('true and "true" are different variants', () => {
    const yes = z.object({ ok: z.literal(true) });
    const quoted = z.object({ ok: z.literal('true') });

    const walked = walkBody(z.discriminatedUnion('ok', [yes, quoted]));

    expect(walked.kind === 'walked' && walked.nodes[0]).toMatchObject({
      variants: { true: {}, '"true"': {} },
    });
  });

  test('an openUnion is open', () => {
    expect(walkBody(openUnion('type', [card, transfer]))).toMatchObject(
      walkedTo({ type: 'tagged', discriminator: 'type', variants: {}, open: true }),
    );
  });

  test('a described openUnion stays open', () => {
    const payment = openUnion('type', [card, transfer]).describe('A payment');

    expect(walkBody(payment)).toMatchObject(
      walkedTo({ type: 'tagged', discriminator: 'type', variants: {}, open: true }),
    );
  });

  test('an openUnion from another copy of loom-contract is open', () => {
    expect(walkBody(built.openUnion('type', [card]))).toMatchObject(
      walkedTo({ type: 'tagged', discriminator: 'type', variants: {}, open: true }),
    );
  });

  test('a variant whose discriminator has several values fails', () => {
    const either = z.object({ type: z.literal(['card', 'debit']) });

    expect(walkBody(z.discriminatedUnion('type', [either, transfer]))).toEqual(
      refusedAt(
        ['body', 'variants', 0],
        'a discriminated union variant whose discriminator has several values',
      ),
    );
  });

  test('two variants with the same discriminator value fail', () => {
    const otherCard = z.object({ type: z.literal('card'), token: z.string() });

    expect(walkBody(z.discriminatedUnion('type', [card, otherCard]))).toEqual(
      refusedAt(['body'], 'two discriminated union variants with the same discriminator value'),
    );
  });

  test('a variant whose discriminator is not a literal fails', () => {
    const anyType = z.object({ type: z.string() });

    expect(walkBody(z.discriminatedUnion('type', [card, anyType]))).toEqual(
      refusedAt(
        ['body', 'variants', 1],
        'a discriminated union variant whose discriminator is not a literal',
      ),
    );
  });

  test('a variant whose discriminator is a one-value enum fails', () => {
    const wire = z.object({ type: z.enum(['wire']) });

    expect(walkBody(z.discriminatedUnion('type', [card, wire]))).toEqual(
      refusedAt(
        ['body', 'variants', 1],
        'a discriminated union variant whose discriminator is not a literal',
      ),
    );
  });

  test('a discriminated union as a variant of another fails', () => {
    const nested = z.discriminatedUnion('kind', [
      z.object({ type: z.literal('wallet'), kind: z.literal('crypto') }),
    ]);

    expect(walkBody(z.discriminatedUnion('type', [card, nested]))).toEqual(
      refusedAt(['body', 'variants', 1], 'a discriminated union as a variant of another'),
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
      refusedAt(['body', 'variants', 1], 'a discriminated union variant that is not an object'),
    );
  });
});
