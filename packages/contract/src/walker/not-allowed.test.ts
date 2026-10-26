import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { openEnum } from '../index.ts';
import { walkSchemas } from '../internal/index.ts';

type Located = Parameters<typeof walkSchemas>[0];
type Place = Located[number]['at'];

function exportAt(name: string): Place {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] };
}

const bodyAt = exportAt('body');
const successAt = exportAt('success');

function walkBodyRaw(schema: core.$ZodType) {
  return walkSchemas([{ at: bodyAt, schema }], () => undefined);
}

function walkBody(schema: core.$ZodType) {
  return refusalsOf(walkBodyRaw(schema));
}

function refused(construct: string, instead?: string) {
  return refusedAt('', construct, instead);
}

function refusedAt(at: string, construct: string, instead?: string) {
  return refusedAll([failureAt(at, construct, instead)]);
}

function failureAt(at: string, construct: string, instead?: string) {
  return { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
}

function refusedAll(failures: readonly ReturnType<typeof failureAt>[]) {
  return { located: [{ kind: 'not-allowed', failures }], defs: {} };
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
    const failures = [failureAt('', '.nonoptional()'), failureAt('', '.optional()')];

    expect(walkBody(z.string().optional().nonoptional())).toEqual(refusedAll(failures));
  });

  test.each([
    { name: '.default()', schema: z.array(z.date()).default([]), steps: ['[]'] },
    { name: 'z.looseRecord()', schema: z.looseRecord(z.string(), z.date()), steps: ['{}'] },
    { name: 'z.xor()', schema: z.xor([z.date(), z.string()]), steps: ['<|0>'] },
    { name: 'z.map()', schema: z.map(z.date(), z.date()), steps: ['{key}', '{}'] },
    {
      name: 'z.function()',
      schema: z.function({ input: [z.date()], output: z.string() }),
      steps: ['[0]'],
    },
  ])('what lies inside $name is reported beside it', ({ name, schema, steps }) => {
    const order = z.object({ when: schema });

    const dates = steps.map((step) => failureAt(`when${step}`, 'z.date()', 'z.iso.datetime()'));
    const failures = [failureAt('when', name), ...dates];
    expect(walkBody(order)).toEqual(refusedAll(failures));
  });

  test('a refusal stacked on itself is reported once', () => {
    const order = z.object({ note: z.string().default('a').default('b') });

    expect(walkBody(order)).toEqual(refusedAt('note', '.default()'));
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
      refusedAt('<|1>', 'z.null()', '.nullable()'),
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
  const items = failureAt('[]', 'z.date()', 'z.iso.datetime()');
  const refine = failureAt('', '.refine()');
  const conditional = failureAt('', 'a conditional check');

  test('a .refine() on an array whose items fail is reported beside the items', () => {
    const schema = z.array(z.date()).refine(isFilled);

    expect(walkBody(schema)).toEqual(refusedAll([items, refine]));
  });

  test('a .refine() on a refused .default() is reported beside it', () => {
    const schema = z.array(z.string()).default([]).refine(isFilled);

    expect(walkBody(schema)).toEqual(refusedAll([failureAt('', '.default()'), refine]));
  });

  test.each([
    ['optional', z.date().optional().refine(isFilled)],
    ['nonoptional', z.date().nonoptional().refine(isFilled)],
  ])(
    "a .refine() on a field's .%s() whose schema fails is reported at the field",
    (_name, field) => {
      const date = failureAt('a', 'z.date()', 'z.iso.datetime()');

      expect(walkBody(z.object({ a: field }))).toEqual(
        refusedAll([date, failureAt('a', '.refine()')]),
      );
    },
  );

  test('a conditional check is reported beside a .refine() on the same schema', () => {
    const schema = z.string().refine(isFilled).check(z.minLength(1, whenAlways));

    expect(walkBody(schema)).toEqual(refusedAll([refine, conditional]));
  });

  test('a conditional check is reported beside two checks that set one bound', () => {
    const schema = z.string().check(z.minLength(1, whenAlways)).min(2).min(3);

    const repeated = failureAt('', 'two checks that set a lower bound');
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

    expect(walkBody(schema)).toEqual(refusedAll([failureAt('', '.default()'), refine]));
  });

  test('a length check on a refused .default() of a number is reported', () => {
    const schema: z.ZodType = z.number().default(0);

    const length = failureAt('', 'z.minLength()');
    expect(walkBody(schema.check(z.minLength(1)))).toEqual(
      refusedAll([failureAt('', '.default()'), length]),
    );
  });

  test('a check on a lazy that reaches itself through .nullable() ends the walk', () => {
    const looping: z.ZodType = z.lazy(() => looping.nullable()).check(z.minLength(1));

    const cycle = failureAt('', 'a cycle without .meta({ id })', '.meta({ id })');
    const length = failureAt('', 'z.minLength()');
    expect(walkBody(looping)).toEqual(refusedAll([cycle, length]));
  });

  test('a lazy that reaches itself before a .nullable() ends the walk', () => {
    const looping: z.ZodType = z.lazy(() => looping).nullable();

    const cycle = failureAt('', 'a cycle without .meta({ id })', '.meta({ id })');
    expect(walkBody(looping)).toEqual(refusedAll([cycle]));
  });
});

describe('walkSchemas: every refused check is reported once wherever the node fails', () => {
  type Decorate = (schema: z.ZodType) => z.ZodType;
  type Failure = ReturnType<typeof failureAt>;

  const asIs: Decorate = (schema) => schema;
  const body = '';
  const field = 'a';
  const cycle = (at: string) => [failureAt(at, 'a cycle without .meta({ id })', '.meta({ id })')];

  /** Where a length check on the inner schema is taken: a use of a cycle's schema is a `ref`. */
  type TakesLength = 'nowhere' | 'anywhere' | 'on itself alone';

  const failing = [
    {
      name: 'z.date()',
      make: (decorate: Decorate) => decorate(z.date()),
      refusals: (at: string) => [failureAt(at, 'z.date()', 'z.iso.datetime()')],
      takesLength: 'nowhere' as TakesLength,
    },
    {
      name: 'a refused .default() of an array',
      make: (decorate: Decorate) => decorate(z.array(z.string()).default([])),
      refusals: (at: string) => [failureAt(at, '.default()')],
      takesLength: 'anywhere' as TakesLength,
    },
    {
      name: 'a refused .default() of a number',
      make: (decorate: Decorate) => decorate(z.number().default(0)),
      refusals: (at: string) => [failureAt(at, '.default()')],
      takesLength: 'nowhere' as TakesLength,
    },
    {
      name: 'a cycle through z.lazy()',
      make: (decorate: Decorate) => {
        const loop: z.ZodType = decorate(z.lazy(() => loop));
        return loop;
      },
      refusals: cycle,
      takesLength: 'nowhere' as TakesLength,
    },
    {
      name: 'a cycle through .nullable()',
      make: (decorate: Decorate) => {
        const loop: z.ZodType = decorate(z.lazy(() => loop.nullable()));
        return loop;
      },
      refusals: cycle,
      takesLength: 'nowhere' as TakesLength,
    },
    {
      name: 'a cycle through an array',
      make: (decorate: Decorate) => {
        const loop: z.ZodType = decorate(z.array(z.lazy(() => loop)));
        return loop;
      },
      refusals: (at: string) => cycle(`${at}[]`),
      takesLength: 'on itself alone' as TakesLength,
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
      onItself: true,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => inner.make(apply),
    },
    {
      name: "in a field's .optional()",
      at: field,
      onItself: false,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => z.object({ a: apply(inner.make(asIs).optional()) }),
    },
    {
      name: "in a field's .nonoptional()",
      at: field,
      onItself: false,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) =>
        z.object({ a: apply(inner.make(asIs).nonoptional()) }),
    },
    {
      name: 'in .nullable()',
      at: body,
      onItself: false,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => apply(inner.make(asIs).nullable()),
    },
    {
      name: 'in z.lazy()',
      at: body,
      onItself: false,
      surrounding: [] as Failure[],
      build: (inner: Inner, apply: Decorate) => {
        const schema = inner.make(asIs);
        return apply(z.lazy(() => schema));
      },
    },
    {
      name: 'in a refused .default()',
      at: body,
      onItself: false,
      surrounding: [failureAt(body, '.default()')],
      build: (inner: Inner, apply: Decorate) => apply(inner.make(asIs).default(undefined as never)),
    },
  ];

  function once(failures: readonly Failure[]): Failure[] {
    return [...new Map(failures.map((failure) => [JSON.stringify(failure), failure])).values()];
  }

  function takesLength(inner: Inner, place: (typeof places)[number]): boolean {
    return (
      inner.takesLength === 'anywhere' ||
      (inner.takesLength === 'on itself alone' && place.onItself)
    );
  }

  const cases = places.flatMap((place) =>
    failing.flatMap((inner) =>
      checked.map((checks) => ({
        name: `${checks.name} on ${inner.name} ${place.name}`,
        schema: place.build(inner, checks.apply),
        failures: once([
          ...place.surrounding,
          ...inner.refusals(place.at),
          ...checks
            .refusals(takesLength(inner, place))
            .map((construct) => failureAt(place.at, construct)),
        ]),
      })),
    ),
  );

  test.each(cases)('$name', ({ schema, failures }) => {
    expect(walkBody(schema)).toEqual(refusedAll(failures));
  });
});

describe('walkSchemas: the checks of a failed node are judged by the node it was building', () => {
  const repeated = failureAt('', 'two checks that set a lower bound');
  const items = failureAt('[]', 'z.date()', 'z.iso.datetime()');

  test.each<[string, z.ZodType]>([
    ['z.coerce.date()', z.coerce.date()],
    ['z.coerce.bigint()', z.coerce.bigint()],
  ])('%s is refused beside the type it coerces to', (name, schema) => {
    const type = name.replace('coerce.', '');

    expect(walkBody(schema)).toMatchObject(
      refusedAll([failureAt('', 'z.coerce.*'), expect.objectContaining({ construct: type })]),
    );
  });

  test.each<[string, z.ZodType]>([
    ['z.coerce.number().min(1)', z.coerce.number().min(1)],
    ['z.coerce.string().min(1)', z.coerce.string().min(1)],
  ])('a check the coerced type takes is not reported on %s', (_name, schema) => {
    expect(walkBody(schema)).toEqual(refused('z.coerce.*'));
  });

  test.each<[string, z.ZodType]>([
    ['.catch()', z.array(z.string()).catch([])],
    ['.prefault()', z.array(z.string()).prefault([])],
    ['.readonly()', z.array(z.string()).readonly()],
    ['z.promise()', z.promise(z.array(z.string()))],
    ['z.success()', z.success(z.array(z.string()))],
  ])('a length check on a refused %s around an array is not reported', (name, schema) => {
    expect(walkBody(schema.check(z.minLength(1)))).toEqual(refused(name));
  });

  test('a length check through .nullable() on an array whose metadata fails is not reported', () => {
    const annotated: z.ZodType = z.array(z.string()).meta({ unit: 'items' }).nullable();

    expect(walkBody(annotated.check(z.minLength(1)))).toEqual(refused('.meta({ unit })'));
  });

  test('a bound set again through .nullable() is refused', () => {
    const nullable: z.ZodType = z.string().min(1).nullable();

    expect(walkBody(nullable.check(z.minLength(2)))).toEqual(refusedAll([repeated]));
  });

  test('a bound set again on a schema a .refine() already failed is refused', () => {
    const nullable: z.ZodType = z.string().refine(isFilled).min(1).nullable();

    expect(walkBody(nullable.check(z.minLength(2)))).toEqual(
      refusedAll([failureAt('', '.refine()'), repeated]),
    );
  });

  test.each<[string, z.ZodType]>([
    ['.nullable()', z.array(z.date()).min(1).nullable()],
    ['z.lazy()', z.lazy(() => z.array(z.date()).min(1))],
  ])('a bound set again through %s on an array whose items fail is refused', (_name, schema) => {
    expect(walkBody(schema.check(z.minLength(2)))).toEqual(refusedAll([items, repeated]));
  });

  describe('a schema with an id on a cycle is a ref wherever it is used, so a use takes no check', () => {
    const treeOf = (leaf: z.ZodType) => {
      const tree: z.ZodType = z.array(z.union([z.lazy(() => tree), leaf])).meta({ id: 'tree' });
      return tree;
    };
    const length = (at: string) => failureAt(at, 'z.minLength()');
    const leafFailure = (at: string) => failureAt(`${at}[]<|1>`, 'z.date()', 'z.iso.datetime()');

    const uses = [
      {
        name: 'through z.lazy()',
        at: '',
        use: (tree: z.ZodType) => z.lazy(() => tree).check(z.minLength(1)),
        around: [] as ReturnType<typeof failureAt>[],
      },
      {
        name: 'through .nullable()',
        at: '',
        use: (tree: z.ZodType) => tree.nullable().check(z.minLength(1)),
        around: [],
      },
      {
        name: "through a field's .optional()",
        at: 'a',
        use: (tree: z.ZodType) => z.object({ a: tree.optional().check(z.minLength(1)) }),
        around: [],
      },
      {
        name: 'through a refused .default()',
        at: '',
        use: (tree: z.ZodType) => tree.default([]).check(z.minLength(1)),
        around: [failureAt('', '.default()')],
      },
    ];

    test.each(uses)('a length check on a use $name of a def is refused', ({ at, use, around }) => {
      const walked = walkBody(use(treeOf(z.string())));

      expect(walked.located[0]).toEqual({
        kind: 'not-allowed',
        failures: [...around, length(at)],
      });
    });

    test.each(uses)(
      'a length check on a use $name of a failing def is refused beside its failure',
      ({ at, use, around }) => {
        const walked = walkBody(use(treeOf(z.date())));

        expect(walked.located[0]).toEqual({
          kind: 'not-allowed',
          failures: [...around, leafFailure(at), length(at)],
        });
      },
    );

    test('the checks of the def itself are judged by its own type, failing or not', () => {
      const tree: z.ZodType = z
        .array(z.union([z.lazy(() => tree), z.date()]))
        .min(1)
        .refine(isFilled)
        .meta({ id: 'tree' });

      expect(walkBody(tree)).toEqual(refusedAll([leafFailure(''), failureAt('', '.refine()')]));
    });
  });

  describe('a schema on a cycle no id names is judged as every schema of it would be with an id', () => {
    const unnamedCycle = 'a cycle without .meta({ id })';
    type WalkedSchemas = ReturnType<typeof walkSchemas>;
    type WalkedLocation = WalkedSchemas['located'][number];

    const constructsIn = (location: WalkedLocation | undefined) =>
      location?.walked.kind === 'not-allowed'
        ? location.walked.failures.map((failure) => failure.construct)
        : [];
    const constructsAt = (walked: WalkedSchemas, at: Place) =>
      constructsIn(walked.located.find((candidate) => candidate.at === at));
    const constructsOf = (walked: WalkedSchemas) => [
      ...new Set(walked.located.flatMap((location) => constructsIn(location))),
    ];

    /** The two schemas of one cycle: the array that builds the node and the lazy standing for it. */
    const cycleOf = () => {
      const children: z.ZodType = z.lazy(() => loop);
      const loop = z.array(children);
      return { loop, children };
    };
    type Cycle = ReturnType<typeof cycleOf>;

    const orders = [
      {
        name: 'the other schema of the cycle walked first',
        locate: (other: z.ZodType, schema: z.ZodType): Located => [
          { at: bodyAt, schema: other },
          { at: successAt, schema },
        ],
      },
      {
        name: 'walked first',
        locate: (other: z.ZodType, schema: z.ZodType): Located => [
          { at: successAt, schema },
          { at: bodyAt, schema: other },
        ],
      },
      {
        name: 'walked alone',
        locate: (_other: z.ZodType, schema: z.ZodType): Located => [{ at: successAt, schema }],
      },
    ];

    describe('a length check on a use of a schema of the cycle is refused', () => {
      const members = [
        {
          name: 'the array',
          of: (cycle: Cycle) => cycle.loop,
          other: (cycle: Cycle) => cycle.children,
        },
        {
          name: 'the z.lazy() standing for it',
          of: (cycle: Cycle) => cycle.children,
          other: (cycle: Cycle) => cycle.loop,
        },
      ];
      const uses = [
        {
          name: 'through z.lazy()',
          use: (member: z.ZodType) => z.lazy(() => member).check(z.minLength(1)),
          around: [] as string[],
        },
        {
          name: 'through .nullable()',
          use: (member: z.ZodType) => member.nullable().check(z.minLength(1)),
          around: [] as string[],
        },
        {
          name: "through a field's .optional()",
          use: (member: z.ZodType) => z.object({ a: member.optional().check(z.minLength(1)) }),
          around: [] as string[],
        },
        {
          name: 'through a refused .default()',
          use: (member: z.ZodType) => member.default([]).check(z.minLength(1)),
          around: ['.default()'],
        },
      ];
      const cases = members.flatMap((member) =>
        uses.flatMap((use) =>
          orders.map((order) => ({
            name: `${member.name} ${use.name}, ${order.name}`,
            member,
            use,
            order,
          })),
        ),
      );

      test.each(cases)('$name', ({ member, use, order }) => {
        const cycle = cycleOf();
        const located = order.locate(member.other(cycle), use.use(member.of(cycle)));

        const walked = walkSchemas(located, () => undefined);

        expect(constructsAt(walked, successAt)).toEqual([
          ...use.around,
          unnamedCycle,
          'z.minLength()',
        ]);
      });
    });

    describe('the own checks of a schema of the cycle are judged by the node its own def builds', () => {
      const ownChecks = [
        {
          name: 'the array takes its own length check',
          make: () => {
            const children: z.ZodType = z.lazy(() => loop);
            const loop = z.array(children).check(z.minLength(1));
            return { schema: loop, other: children };
          },
          refused: [] as string[],
        },
        {
          name: 'the z.lazy() standing for it refuses its own length check',
          make: () => {
            const children: z.ZodType = z.lazy(() => loop).check(z.minLength(1));
            const loop = z.array(children);
            return { schema: children, other: loop };
          },
          refused: ['z.minLength()'],
        },
        {
          name: 'the .nullable() standing for it refuses its own length check',
          make: () => {
            const children: z.ZodType = z.lazy(() => loop);
            const nullable: z.ZodType = z.array(children).nullable();
            const loop = nullable.check(z.minLength(1));
            return { schema: loop, other: children };
          },
          refused: ['z.minLength()'],
        },
      ];
      const cases = ownChecks.flatMap((own) =>
        orders.map((order) => ({ name: `${own.name}, ${order.name}`, own, order })),
      );

      test.each(cases)('$name', ({ own, order }) => {
        const { schema, other } = own.make();

        const walked = walkSchemas(order.locate(other, schema), () => undefined);

        expect(constructsOf(walked)).toEqual([unnamedCycle, ...own.refused]);
      });
    });

    test.each(orders)(
      'a schema without an id on a cycle an id names keeps the node it was building, $name',
      ({ locate }) => {
        const children: z.ZodType = z.lazy(() => loop).meta({ id: 'children' });
        const loop: z.ZodType = z.array(z.union([children, z.date()]));
        const use = loop.nullable().check(z.minLength(1));

        const walked = walkSchemas(locate(loop, use), () => undefined);

        expect(new Set(constructsAt(walked, successAt))).toEqual(new Set(['z.date()']));
      },
    );

    test('a cycle whose only id is refused is one no id names, so a use of it refuses a length check', () => {
      const treeOf = (id: string) => {
        const tree: z.ZodType = z.array(z.lazy(() => tree)).meta({ id });
        return tree;
      };
      const useOf = (tree: z.ZodType) => z.lazy(() => tree).check(z.minLength(1));

      const refusedId = walkBodyRaw(useOf(treeOf('Tree')));

      expect(refusalsOf(refusedId)).toEqual(
        refusedAll([
          failureAt('', '.meta({ id: "Tree" })', 'a camelCase name'),
          failureAt('[]', unnamedCycle, '.meta({ id })'),
          failureAt('', 'z.minLength()'),
        ]),
      );
      expect(constructsOf(refusedId)).toEqual([
        '.meta({ id: "Tree" })',
        unnamedCycle,
        ...constructsOf(walkBodyRaw(useOf(treeOf('tree')))),
      ]);
    });
  });
});

describe('walkSchemas: constraints that admit no value', () => {
  const noValue = 'bounds that admit no value';
  const nonPositiveStep = 'a multipleOf of 0 or less';
  const lengthBound = 'a length bound that is not a non-negative integer';

  test.each<[string, z.ZodType]>([
    ['multipleOf(0)', z.number().multipleOf(0)],
    ['a negative multipleOf', z.number().multipleOf(-2)],
  ])('%s fails', (_name, schema) => {
    expect(walkBody(schema)).toEqual(refused(nonPositiveStep));
  });

  test.each<[string, z.ZodType]>([
    ['a string min above its max', z.string().min(5).max(3)],
    ['an array min above its max', z.array(z.string()).min(5).max(3)],
    ['a number min above its max', z.number().min(5).max(3)],
    ['.gt(5).lt(5)', z.number().gt(5).lt(5)],
    ['.gt(5).max(5)', z.number().gt(5).max(5)],
  ])('%s admits no value and fails', (_name, schema) => {
    expect(walkBody(schema)).toEqual(refused(noValue));
  });

  test.each<[string, z.ZodType]>([
    ['a string', z.string().min(5).max(5)],
    ['an array', z.array(z.string()).length(0)],
    ['a number', z.number().min(5).max(5)],
  ])('%s bounded at one value walks', (_name, schema) => {
    expect(walkBody(schema).located[0]?.kind).toBe('walked');
  });

  test.each<[string, z.ZodType]>([
    ['a negative string length', z.string().min(-1)],
    ['a fractional string length', z.string().length(2.5)],
    ['a negative array length', z.array(z.string()).min(-1)],
    ['a fractional array length', z.array(z.string()).max(1.5)],
  ])('%s fails', (_name, schema) => {
    expect(walkBody(schema)).toEqual(refused(lengthBound));
  });

  test('bounds set across a .nullable() are judged together', () => {
    const schema: z.ZodType = z.string().min(5).nullable();

    expect(walkBody(schema.check(z.maxLength(3)))).toEqual(refused(noValue));
  });

  test('crossed bounds are reported beside items that fail', () => {
    const schema = z.array(z.date()).min(5).max(3);

    expect(walkBody(schema)).toEqual(
      refusedAll([failureAt('[]', 'z.date()', 'z.iso.datetime()'), failureAt('', noValue)]),
    );
  });

  test('crossed bounds are reported beside a .refine() on the same schema', () => {
    const schema = z
      .string()
      .min(5)
      .max(3)
      .refine((value) => value !== '');

    expect(walkBody(schema)).toEqual(
      refusedAll([failureAt('', '.refine()'), failureAt('', noValue)]),
    );
  });
});
