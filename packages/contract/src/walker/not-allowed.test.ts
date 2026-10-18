import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function refused(construct: string, instead?: string) {
  return {
    kind: 'not-allowed',
    failures: [{ at: ['body'], construct, ...(instead && { instead }) }],
  };
}

const mutating = '.trim(), .toLowerCase(), .toUpperCase(), .normalize() or .overwrite()';
const dynamicValue = 'z.record() or z.json()';
const nonFinite = 'a number that is not finite (NaN or Infinity)';
const looseObject = 'z.looseObject() or .passthrough()';

describe('walkSchemas: the Not allowed list', () => {
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
    ['z.coerce.*', z.coerce.number(), 'z.coerce.*'],
    ['z.stringbool()', z.stringbool(), 'z.stringbool()'],
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
    [
      '.nonoptional() outside an object field',
      z.string().optional().nonoptional(),
      '.nonoptional()',
    ],
    ['z.literal(NaN)', z.literal(Number.NaN), nonFinite],
    ['z.literal(Infinity)', z.literal(Number.POSITIVE_INFINITY), nonFinite],
    ['.max(Infinity) on a number', z.number().max(Number.POSITIVE_INFINITY), nonFinite],
    ['.min(-Infinity) on a number', z.number().min(Number.NEGATIVE_INFINITY), nonFinite],
    ['.max(Infinity) on a string', z.string().max(Number.POSITIVE_INFINITY), nonFinite],
    ['.lowercase()', z.string().lowercase(), '.lowercase()'],
    ['.uppercase()', z.string().uppercase(), '.uppercase()'],
    ['z.stringFormat()', z.stringFormat('sku', () => true), 'z.stringFormat("sku")'],
    ['z.email({ pattern })', z.email({ pattern: z.regexes.html5Email }), 'z.email({ pattern })'],
    ['z.url({ normalize })', z.url({ normalize: true }), 'z.url({ normalize: true })'],
    ['z.int32()', z.int32(), 'z.int32()'],
    ['z.uint32()', z.uint32(), 'z.uint32()'],
    ['z.float32()', z.float32(), 'z.float32()'],
    ['z.float64()', z.float64(), 'z.float64()'],
    ['z.looseRecord()', z.looseRecord(z.string(), z.string()), 'z.looseRecord()'],
    ['z.xor()', z.xor([z.string(), z.number()]), 'z.xor()'],
    ['two checks that set one constraint', z.string().min(1).min(2), 'two checks that set min'],
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
    ['a standalone z.null()', z.null(), refused('z.null()', 'nullable')],
    ['z.undefined()', z.undefined(), refused('z.undefined()', 'nullable')],
    ['z.literal(null)', z.literal(null), refused('z.literal(null)', 'nullable')],
  ])('%s fails with what to use instead', (_name, schema, failure) => {
    expect(walkBody(schema)).toEqual(failure);
  });
});
