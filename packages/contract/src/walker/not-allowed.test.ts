import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function refused(construct: string, instead?: string) {
  return refusedAt(['body'], construct, instead);
}

function refusedAt(at: readonly (string | number)[], construct: string, instead?: string) {
  const failure = { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
  return {
    located: [{ at: ['body'], walked: { kind: 'not-allowed', failures: [failure] } }],
    defs: {},
  };
}

const mutating = '.trim(), .toLowerCase(), .toUpperCase(), .normalize() or .overwrite()';
const dynamicValue = 'z.record() or z.json()';
const nonFinite = 'a number that is not finite (NaN or Infinity)';
/** A pattern option the types of most formats refuse, as an author could still pass it. */
function patternOf(pattern: RegExp): object {
  return { pattern };
}

const customPattern = 'a format with a custom pattern';
const looseObject = 'z.looseObject() or .passthrough()';

describe('walkSchemas: the Not allowed list', () => {
  test('.nonoptional() outside an object field fails, and so does the .optional() inside it', () => {
    const failures = [
      { kind: 'not-allowed', at: ['body'], construct: '.nonoptional()' },
      { kind: 'not-allowed', at: ['body'], construct: '.optional()' },
    ];

    expect(walkBody(z.string().optional().nonoptional())).toEqual({
      located: [{ at: ['body'], walked: { kind: 'not-allowed', failures } }],
      defs: {},
    });
  });

  test.each([
    { name: '.default()', schema: z.array(z.date()).default([]), steps: [['items']] },
    {
      name: 'z.looseRecord()',
      schema: z.looseRecord(z.string(), z.date()),
      steps: [['value']],
    },
    { name: 'z.xor()', schema: z.xor([z.date(), z.string()]), steps: [['options', 0]] },
    { name: 'z.map()', schema: z.map(z.date(), z.date()), steps: [['key'], ['value']] },
    {
      name: 'z.function()',
      schema: z.function({ input: [z.date()], output: z.string() }),
      steps: [['items', 0]],
    },
  ])('what lies inside $name is reported beside it', ({ name, schema, steps }) => {
    const order = z.object({ when: schema });

    const at = ['body', 'fields', 'when'];
    const dates = steps.map((step) => ({
      kind: 'not-allowed',
      at: [...at, ...step],
      construct: 'z.date()',
      instead: 'z.iso.datetime()',
    }));
    const failures = [{ kind: 'not-allowed', at, construct: name }, ...dates];
    expect(walkBody(order)).toEqual({
      located: [{ at: ['body'], walked: { kind: 'not-allowed', failures } }],
      defs: {},
    });
  });

  test('a refusal stacked on itself is reported once', () => {
    const order = z.object({ note: z.string().default('a').default('b') });

    expect(walkBody(order)).toEqual(refusedAt(['body', 'fields', 'note'], '.default()'));
  });

  test.each([
    ['.default()', z.string().default('x'), '.default()'],
    ['.prefault()', z.string().prefault('x'), '.prefault()'],
    ['.catch()', z.string().catch('x'), '.catch()'],
    ['.transform()', z.string().transform((value) => value.length), '.transform()'],
    ['.preprocess()', z.preprocess((value) => value, z.string()), '.preprocess()'],
    ['.pipe()', z.string().pipe(z.string()), '.pipe()'],
    ['.refine()', z.string().refine((value) => value !== ''), '.refine()'],
    ['.superRefine()', z.string().superRefine(() => undefined), '.superRefine() or .check()'],
    ['.check()', z.string().check(() => undefined), '.superRefine() or .check()'],
    ['a zod/mini custom check', zm.string().check(zm.refine((value) => value !== '')), '.refine()'],
    ['z.custom()', z.custom<string>(), 'z.custom()'],
    ['z.codec()', z.codec(z.string(), z.number(), { decode: Number, encode: String }), 'z.codec()'],
    [
      'a zod/mini z.codec()',
      zm.codec(zm.string(), zm.number(), { decode: Number, encode: String }),
      'z.codec()',
    ],
    [
      'a zod/mini transform',
      zm.pipe(
        zm.string(),
        zm.transform((value) => value.length),
      ),
      '.transform()',
    ],
    ['a zod/mini pipe', zm.pipe(zm.string(), zm.string()), '.pipe()'],
    ['z.coerce.*', z.coerce.number(), 'z.coerce.*'],
    ['z.coerce.date()', z.coerce.date(), 'z.coerce.*'],
    ['z.coerce.bigint()', z.coerce.bigint(), 'z.coerce.*'],
    ['z.stringbool()', z.stringbool(), 'z.stringbool()'],
    ['a zod/mini z.stringbool()', zm.stringbool(), 'z.stringbool()'],
    ['z.templateLiteral()', z.templateLiteral(['order-', z.number()]), 'z.templateLiteral()'],
    ['.trim()', z.string().trim(), mutating],
    ['.toLowerCase()', z.string().toLowerCase(), mutating],
    ['.toUpperCase()', z.string().toUpperCase(), mutating],
    ['.normalize()', z.string().normalize(), mutating],
    ['.overwrite()', z.string().overwrite((value) => value), mutating],
    ['.startsWith()', z.string().startsWith('order-'), '.startsWith()'],
    ['.endsWith()', z.string().endsWith('.json'), '.endsWith()'],
    ['.includes()', z.string().includes('@'), '.includes()'],
    ['.readonly()', z.array(z.string()).readonly(), '.readonly()'],
    ['numeric z.enum() values', z.enum({ low: 1, high: 2 }), 'numeric z.enum() values'],
    ['.optional() outside an object field', z.string().optional(), '.optional()'],
    ['z.literal(NaN)', z.literal(Number.NaN), nonFinite],
    ['z.literal(Infinity)', z.literal(Number.POSITIVE_INFINITY), nonFinite],
    ['.max(Infinity) on a number', z.number().max(Number.POSITIVE_INFINITY), nonFinite],
    ['.min(-Infinity) on a number', z.number().min(Number.NEGATIVE_INFINITY), nonFinite],
    ['.max(Infinity) on a string', z.string().max(Number.POSITIVE_INFINITY), nonFinite],
    [
      'a conditional length check',
      z.string().min(5, { when: () => true } as object),
      'a conditional check',
    ],
    ['a conditional format', z.url({ when: () => true } as object), 'a conditional check'],
    ['.lowercase()', z.string().lowercase(), '.lowercase()'],
    ['.uppercase()', z.string().uppercase(), '.uppercase()'],
    ['z.stringFormat()', z.stringFormat('sku', () => true), 'z.stringFormat("sku")'],
    ['z.email({ pattern })', z.email({ pattern: z.regexes.html5Email }), customPattern],
    ['z.uuid({ pattern })', z.uuid(patternOf(/^[0-9a-f-]+$/)), customPattern],
    ['z.cuid({ pattern })', z.cuid({ pattern: /^c/ }), customPattern],
    ['z.iso.date({ pattern })', z.iso.date(patternOf(/^\d{8}$/)), customPattern],
    ['z.guid({ pattern })', z.guid(patternOf(/^g/)), customPattern],
    ['z.ipv4({ pattern })', z.ipv4(patternOf(/^10\./)), customPattern],
    [
      'z.stringFormat() of a known name with a regex',
      z.stringFormat('uuid', /^u/),
      'z.stringFormat("uuid")',
    ],
    [
      'z.stringFormat() of a known name with a check',
      z.stringFormat('hex', () => true),
      'z.stringFormat("hex")',
    ],
    ['a regex-built format with its own regex', z.stringFormat('hex', /^[a-f]+$/), customPattern],
    ['z.url({ normalize })', z.url({ normalize: true }), 'z.url({ normalize })'],
    ['z.int32()', z.int32(), 'z.int32()'],
    ['z.uint32()', z.uint32(), 'z.uint32()'],
    ['z.float32()', z.float32(), 'z.float32()'],
    ['z.float64()', z.float64(), 'z.float64()'],
    ['z.looseRecord()', z.looseRecord(z.string(), z.string()), 'z.looseRecord()'],
    ['z.xor()', z.xor([z.string(), z.number()]), 'z.xor()'],
    ['two checks that set min', z.string().min(1).min(2), 'two checks that set a lower bound'],
    [
      'two checks that set max',
      z.array(z.string()).max(1).max(2),
      'two checks that set an upper bound',
    ],
    ['a length and a max', z.string().length(2).max(5), 'two checks that set an upper bound'],
    [
      'two checks that set multipleOf',
      z.number().multipleOf(2).multipleOf(3),
      'two checks that set multipleOf',
    ],
    [
      '.positive().nonnegative()',
      z.number().positive().nonnegative(),
      'two checks that set a lower bound',
    ],
    ['.max() and .lt()', z.number().max(5).lt(10), 'two checks that set an upper bound'],
    ['two regexes', z.string().regex(/a/).regex(/b/), 'two checks that set regex'],
    ['two formats', z.string().email().uuid(), 'two checks that set format'],
  ])('%s fails', (_name, schema, construct) => {
    expect(walkBody(schema)).toEqual(refused(construct));
  });

  test.each([
    ['z.date()', z.date(), refused('z.date()', 'z.iso.datetime()')],
    ['z.unknown()', z.unknown(), refused('z.unknown()', dynamicValue)],
    ['z.any()', z.any(), refused('z.any()', dynamicValue)],
    ['.passthrough()', z.object({}).passthrough(), refused(looseObject, 'z.record()')],
    ['z.looseObject()', z.looseObject({}), refused(looseObject, 'z.record()')],
    ['.catchall()', z.object({}).catchall(z.string()), refused('.catchall()', 'z.record()')],
    ['a standalone z.null()', z.null(), refused('z.null()', '.nullable()')],
    [
      'a union with a z.null() option',
      z.union([z.string(), z.null()]),
      refusedAt(['body', 'options', 1], 'z.null()', '.nullable()'),
    ],
    ['z.undefined()', z.undefined(), refused('z.undefined()', '.nullable()')],
    ['z.literal(null)', z.literal(null), refused('z.literal(null)', '.nullable()')],
  ])('%s fails with what to use instead', (_name, schema, failure) => {
    expect(walkBody(schema)).toEqual(failure);
  });
});
