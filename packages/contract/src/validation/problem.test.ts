import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Read, readWith } from '../internal/index.ts';

function firstProblemOf(read: Read<unknown>) {
  if (read.kind === 'read') {
    throw new Error(`Expected a refused value: ${JSON.stringify(read.value)}`);
  }
  return read.problems[0];
}

describe('readWith', () => {
  test('a value the schema accepts is read as the schema outputs it', () => {
    const schema = z.strictObject({ name: z.string() });

    const read = readWith(schema, { name: 'orders' }, 'its format');

    expect(read).toEqual({ kind: 'read', value: { name: 'orders' } });
  });

  test.for([
    ['a number where a string belongs', z.string(), 1, 'is not a string'],
    ['a string where a number belongs', z.number(), 'x', 'is not a number'],
    ['a fraction where a whole number belongs', z.int(), 1.5, 'is not a whole number'],
    ['a string where true or false belongs', z.boolean(), 'x', 'is not true or false'],
    ['an object where a list belongs', z.array(z.string()), {}, 'is not a list'],
    ['a list where an object belongs', z.object({}), [], 'is not an object'],
    ['null where a string belongs', z.string(), null, 'is not a string'],
  ] as const)('%s says what it is not', ([_, schema, value, reason]) => {
    const read = readWith(schema, value, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: [], reason });
  });

  test('a key the object has not got says it is missing', () => {
    const schema = z.strictObject({ name: z.string() });

    const read = readWith(schema, {}, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: ['name'], reason: 'is missing' });
  });

  test.for([
    ['a value among several', z.enum(['a', 'b'])],
    ['a value that is the only one', z.literal(1)],
    ['a whole number', z.int()],
    ['a union of forms', z.union([z.string(), z.number()])],
    ['an object', z.object({})],
  ] as const)('%s that is not there says it is missing', ([_, schema]) => {
    const read = readWith(z.strictObject({ key: schema }), {}, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: ['key'], reason: 'is missing' });
  });

  test('a discriminator the object has not got says it is missing', () => {
    const schema = z.discriminatedUnion('type', [z.object({ type: z.literal('a') })]);

    const read = readWith(schema, {}, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: ['type'], reason: 'is missing' });
  });

  test.for([
    ['a check', z.string().refine(() => false, 'is not kebab-case')],
    ['a custom schema', z.custom<string>(() => false, 'is not a semantic version')],
    ['a type', z.string({ error: () => 'is not a text' })],
    ['a type, as a union’s', z.union([z.string()], 'is not a text')],
  ] as const)(
    'a value that is not there is missing, whatever message the schema wrote for %s',
    ([_, schema]) => {
      const read = readWith(z.strictObject({ name: schema }), {}, 'its format');

      expect(firstProblemOf(read)).toEqual({ at: ['name'], reason: 'is missing' });
    },
  );

  test('a value that is not there is missing at the root too', () => {
    const read = readWith(z.object({}), undefined, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: [], reason: 'is missing' });
  });

  test('a value that is there keeps the message the schema wrote for it', () => {
    const schema = z.strictObject({ name: z.string({ error: () => 'is not a text' }) });

    const read = readWith(schema, { name: 1 }, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: ['name'], reason: 'is not a text' });
  });

  test('a key of the object that a prototype has, and the object has not, is missing', () => {
    const schema = z.strictObject({ constructor: z.string() });

    const read = readWith(schema, {}, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: ['constructor'], reason: 'is missing' });
  });

  test('a type no document of cf-loom holds says the value is none the definer defines', () => {
    const read = readWith(z.date(), 'x', 'its format');

    expect(firstProblemOf(read)).toEqual({ at: [], reason: 'is not a value its format defines' });
  });

  test.for([
    ['a value among several', z.enum(['a', 'b']), 'c', 'is not "a" or "b"'],
    ['a value that is the only one', z.literal(1), 2, 'is not 1'],
  ] as const)('%s that is not allowed lists what is', ([_, schema, value, reason]) => {
    const read = readWith(schema, value, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: [], reason });
  });

  test.for([
    ['a list below its minimum', z.array(z.string()).min(2), [], 'holds fewer than 2 items'],
    ['a list that must hold one', z.array(z.string()).min(1), [], 'holds fewer than 1 item'],
    ['a list above its maximum', z.array(z.string()).max(1), ['a', 'b'], 'holds more than 1 item'],
    [
      'a list of another length than it must have',
      z.array(z.string()).length(2),
      ['a'],
      'does not hold exactly 2 items',
    ],
    ['a text below its minimum', z.string().min(3), 'a', 'holds fewer than 3 characters'],
    ['a text above its maximum', z.string().max(1), 'ab', 'holds more than 1 character'],
    ['a number below its minimum', z.number().min(3), 2, 'is below 3'],
    ['a number not above its exclusive minimum', z.number().gt(3), 3, 'is not above 3'],
    ['a number above its maximum', z.number().max(3), 4, 'is above 3'],
    ['a number not below its exclusive maximum', z.number().lt(3), 3, 'is not below 3'],
  ] as const)('%s says which bound it breaks', ([_, schema, value, reason]) => {
    const read = readWith(schema, value, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: [], reason });
  });

  test.for([
    ['a number that is no multiple', z.number().multipleOf(5), 7, 'is not a multiple of 5'],
    ['a text that matches no pattern', z.string().regex(/^a/), 'b', 'does not match /^a/'],
    ['a text that is no email', z.email(), 'b', 'is not in the email format'],
  ] as const)('%s says what it must be', ([_, schema, value, reason]) => {
    const read = readWith(schema, value, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: [], reason });
  });

  test('a key the object does not define is named, and whoever defines the object is too', () => {
    const schema = z.strictObject({ name: z.string() });

    const read = readWith(schema, { name: 'x', extra: 1 }, 'the broker plan');

    expect(firstProblemOf(read)).toEqual({
      at: ['extra'],
      reason: 'is a key the broker plan does not define',
    });
  });

  test('a record key that breaks its key schema is named', () => {
    const schema = z.record(z.string().min(2), z.string());

    const read = readWith(schema, { a: 'x' }, 'its format');

    expect(firstProblemOf(read)).toEqual({
      at: ['a'],
      reason: 'is a key that is not a value its format defines',
    });
  });

  test('a value no form of a union takes says so, of whoever defines the forms', () => {
    const read = readWith(z.union([z.string(), z.number()]), true, 'the broker plan');

    expect(firstProblemOf(read).reason).toBe('matches none of the forms the broker plan defines');
  });

  test.for([
    [
      'a discriminator no option has',
      z.discriminatedUnion('type', [z.object({ type: z.literal('a') })]),
      'is not "a"',
    ],
    [
      'a discriminator among several options',
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('a') }),
        z.object({ type: z.literal('b') }),
      ]),
      'is not "a" or "b"',
    ],
  ] as const)('%s lists the values the options have', ([_, schema, reason]) => {
    const read = readWith(schema, { type: 'z' }, 'its format');

    expect(firstProblemOf(read)).toEqual({ at: ['type'], reason });
  });

  test('a check without a message says the value is none the definer defines', () => {
    const schema = z.string().refine((text) => text.length > 3);

    const read = readWith(schema, 'a', 'BrokerLimits');

    expect(firstProblemOf(read)).toEqual({ at: [], reason: 'is not a value BrokerLimits defines' });
  });

  test.for([
    ['a check', z.string().refine(() => false, 'is not kebab-case'), 'x', 'is not kebab-case'],
    [
      'a custom schema',
      z.custom<string>(() => false, 'is not a semantic version'),
      'x',
      'is not a semantic version',
    ],
    ['a minimum', z.array(z.string()).min(1, 'holds no subject'), [], 'holds no subject'],
    [
      'a type',
      z.string({ error: (issue) => (issue.code === 'invalid_type' ? 'is not a text' : undefined) }),
      1,
      'is not a text',
    ],
  ] as const)(
    'a message the schema wrote for %s wins over cf-loom’s words',
    ([_, schema, value, reason]) => {
      const read = readWith(schema, value, 'its format');

      expect(firstProblemOf(read)).toEqual({ at: [], reason });
    },
  );

  test('every place the value breaks the schema is a problem, in the order zod found them', () => {
    const schema = z.strictObject({ name: z.string(), count: z.number() });

    const read = readWith(schema, { name: 1, count: 'x', extra: true }, 'its format');

    expect(read).toEqual({
      kind: 'refused',
      problems: [
        { at: ['name'], reason: 'is not a string' },
        { at: ['count'], reason: 'is not a number' },
        { at: ['extra'], reason: 'is a key its format does not define' },
      ],
    });
  });
});
