import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { openEnum } from '../index.ts';
import { walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function refused(construct: string, instead?: string) {
  return refusedAt(['body'], construct, instead);
}

function refusedAt(at: readonly (string | number)[], construct: string, instead?: string) {
  return refusedAll([failureAt(at, construct, instead)]);
}

function failureAt(at: readonly (string | number)[], construct: string, instead?: string) {
  return { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
}

function refusedAll(failures: readonly ReturnType<typeof failureAt>[]) {
  return {
    located: [{ at: ['body'], walked: { kind: 'not-allowed', failures } }],
    defs: {},
  };
}

const mutating = '.trim(), .toLowerCase(), .toUpperCase(), .normalize() or .overwrite()';
const dynamicValue = 'z.record() or z.json()';
const noValues = 'a z.enum() or z.literal() without values';
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
    ['z.int64()', z.int64(), 'z.bigint()'],
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
    ['a z.enum() with every value excluded', z.enum(['a']).exclude(['a']), noValues],
    ['an openEnum() with every value excluded', openEnum(['a']).exclude(['a']), noValues],
    ['a z.literal() without values', z.literal([]), noValues],
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

const isFilled = (value: unknown) => value !== '';
const whenAlways = { when: () => true } as object;

describe('walkSchemas: the checks of a schema whose node fails', () => {
  const items = failureAt(['body', 'items'], 'z.date()', 'z.iso.datetime()');
  const refine = failureAt(['body'], '.refine()');
  const conditional = failureAt(['body'], 'a conditional check');

  test('a .refine() on an array whose items fail is reported beside the items', () => {
    const schema = z.array(z.date()).refine(isFilled);

    expect(walkBody(schema)).toEqual(refusedAll([items, refine]));
  });

  test('a .refine() on a refused .default() is reported beside it', () => {
    const schema = z.array(z.string()).default([]).refine(isFilled);

    expect(walkBody(schema)).toEqual(refusedAll([failureAt(['body'], '.default()'), refine]));
  });

  test.each([
    ['optional', z.date().optional().refine(isFilled)],
    ['nonoptional', z.date().nonoptional().refine(isFilled)],
  ])(
    "a .refine() on a field's .%s() whose schema fails is reported at the field",
    (_name, field) => {
      const at = ['body', 'fields', 'a'];
      const date = failureAt(at, 'z.date()', 'z.iso.datetime()');

      expect(walkBody(z.object({ a: field }))).toEqual(
        refusedAll([date, failureAt(at, '.refine()')]),
      );
    },
  );

  test('a conditional check is reported beside a .refine() on the same schema', () => {
    const schema = z.string().refine(isFilled).check(z.minLength(1, whenAlways));

    expect(walkBody(schema)).toEqual(refusedAll([refine, conditional]));
  });

  test('a conditional check is reported beside two checks that set one bound', () => {
    const schema = z.string().check(z.minLength(1, whenAlways)).min(2).min(3);

    const repeated = failureAt(['body'], 'two checks that set a lower bound');
    expect(walkBody(schema)).toEqual(refusedAll([conditional, repeated]));
  });

  test('a length check the failed array takes is not reported beside a .refine()', () => {
    const schema = z.array(z.date()).min(1).refine(isFilled);

    expect(walkBody(schema)).toEqual(refusedAll([items, refine]));
  });

  test.each<[string, z.ZodType]>([
    ['z.lazy()', z.lazy(() => z.array(z.date()))],
    ['.nullable()', z.array(z.date()).nullable()],
  ])('a length check under %s is judged by the array inside', (_name, schema) => {
    const checked = schema.check(z.minLength(1)).refine(isFilled);

    expect(walkBody(checked)).toEqual(refusedAll([items, refine]));
  });

  test('a length check on a refused .default() of an array is not reported', () => {
    const schema = z.array(z.string()).default([]).check(z.minLength(1)).refine(isFilled);

    expect(walkBody(schema)).toEqual(refusedAll([failureAt(['body'], '.default()'), refine]));
  });

  test('a length check on a refused .default() of a number is reported', () => {
    const schema: z.ZodType = z.number().default(0);

    const length = failureAt(['body'], 'z.minLength()');
    expect(walkBody(schema.check(z.minLength(1)))).toEqual(
      refusedAll([failureAt(['body'], '.default()'), length]),
    );
  });

  test('a check on a lazy that reaches itself through .nullable() ends the walk', () => {
    const looping: z.ZodType = z.lazy(() => looping.nullable()).check(z.minLength(1));

    const cycle = failureAt(['body'], 'a cycle without .meta({ id })', '.meta({ id })');
    const length = failureAt(['body'], 'z.minLength()');
    expect(walkBody(looping)).toEqual(refusedAll([cycle, length]));
  });

  test('a lazy that reaches itself before a .nullable() ends the walk', () => {
    const looping: z.ZodType = z.lazy(() => looping).nullable();

    const cycle = failureAt(['body'], 'a cycle without .meta({ id })', '.meta({ id })');
    expect(walkBody(looping)).toEqual(refusedAll([cycle]));
  });
});

describe('walkSchemas: every refused check is reported once wherever the node fails', () => {
  type Decorate = (schema: z.ZodType) => z.ZodType;
  type Failure = ReturnType<typeof failureAt>;
  type Path = readonly (string | number)[];

  const asIs: Decorate = (schema) => schema;
  const body: Path = ['body'];
  const field: Path = ['body', 'fields', 'a'];
  const cycle = (at: Path) => [failureAt(at, 'a cycle without .meta({ id })', '.meta({ id })')];

  const failing = [
    {
      name: 'z.date()',
      make: (decorate: Decorate) => decorate(z.date()),
      refusals: (at: Path) => [failureAt(at, 'z.date()', 'z.iso.datetime()')],
      takesLength: false,
    },
    {
      name: 'a refused .default() of an array',
      make: (decorate: Decorate) => decorate(z.array(z.string()).default([])),
      refusals: (at: Path) => [failureAt(at, '.default()')],
      takesLength: true,
    },
    {
      name: 'a refused .default() of a number',
      make: (decorate: Decorate) => decorate(z.number().default(0)),
      refusals: (at: Path) => [failureAt(at, '.default()')],
      takesLength: false,
    },
    {
      name: 'a cycle through z.lazy()',
      make: (decorate: Decorate) => {
        const loop: z.ZodType = decorate(z.lazy(() => loop));
        return loop;
      },
      refusals: cycle,
      takesLength: false,
    },
    {
      name: 'a cycle through .nullable()',
      make: (decorate: Decorate) => {
        const loop: z.ZodType = decorate(z.lazy(() => loop.nullable()));
        return loop;
      },
      refusals: cycle,
      takesLength: false,
    },
  ];

  const checked = [
    {
      name: 'a .refine()',
      apply: (schema: z.ZodType) => schema.refine(isFilled),
      refusals: () => ['.refine()'],
    },
    {
      name: 'a length check',
      apply: (schema: z.ZodType) => schema.check(z.minLength(1)),
      refusals: (takesLength: boolean) => (takesLength ? [] : ['z.minLength()']),
    },
    {
      name: 'a conditional check',
      apply: (schema: z.ZodType) => schema.check(z.minLength(1, whenAlways)),
      refusals: () => ['a conditional check'],
    },
    {
      name: 'a .refine() and a conditional check',
      apply: (schema: z.ZodType) => schema.refine(isFilled).check(z.minLength(1, whenAlways)),
      refusals: () => ['.refine()', 'a conditional check'],
    },
  ];

  type Inner = (typeof failing)[number];
  const places = [
    {
      name: 'on its own',
      at: body,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => inner.make(apply),
    },
    {
      name: "in a field's .optional()",
      at: field,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => z.object({ a: apply(inner.make(asIs).optional()) }),
    },
    {
      name: "in a field's .nonoptional()",
      at: field,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) =>
        z.object({ a: apply(inner.make(asIs).nonoptional()) }),
    },
    {
      name: 'in .nullable()',
      at: body,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => apply(inner.make(asIs).nullable()),
    },
    {
      name: 'in z.lazy()',
      at: body,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => {
        const schema = inner.make(asIs);
        return apply(z.lazy(() => schema));
      },
    },
    {
      name: 'in a refused .default()',
      at: body,
      surrounding: [failureAt(body, '.default()')],
      build: (inner: Inner, apply: Decorate) => apply(inner.make(asIs).default(undefined as never)),
    },
  ];

  function once(failures: readonly Failure[]): Failure[] {
    return [...new Map(failures.map((failure) => [JSON.stringify(failure), failure])).values()];
  }

  const cases = places.flatMap((place) =>
    failing.flatMap((inner) =>
      checked.map((checks) => ({
        name: `${checks.name} on ${inner.name} ${place.name}`,
        schema: place.build(inner, checks.apply),
        failures: once([
          ...place.surrounding,
          ...inner.refusals(place.at),
          ...checks.refusals(inner.takesLength).map((construct) => failureAt(place.at, construct)),
        ]),
      })),
    ),
  );

  test.each(cases)('$name', ({ schema, failures }) => {
    expect(walkBody(schema)).toEqual(refusedAll(failures));
  });
});
