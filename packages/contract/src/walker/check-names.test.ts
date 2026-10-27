import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import * as core from 'zod/v4/core';
import {
  checked,
  type Flavor,
  flavors,
  type NamedCheck,
  type NodeName,
  sweepExports,
  sweepMethods,
  zodFlavor,
} from '../../test/zod-checks.ts';
import { walkSchemas } from '../internal/index.ts';

const bodyAt = {
  site: { kind: 'export', name: 'body' },
  declaration: undefined,
  steps: [],
} as const;

/** The constructs a walk refuses a schema as, in the order it raises them. */
function constructsOf(schema: core.$ZodType): readonly string[] {
  const constructs: string[] = [];
  for (const { walked } of walkSchemas([{ at: bodyAt, schema }], () => undefined).located) {
    if (walked.kind === 'not-allowed') {
      constructs.push(...walked.failures.map((failure) => failure.construct));
    }
  }
  return constructs;
}

/** What names a spelling: the function or method followed by its call, after a `.` or a space. */
function namesSpelling(construct: string, spelling: string): boolean {
  const escaped = spelling.replaceAll('.', '\\.');
  return new RegExp(`(^|[. ])${escaped}\\(`).test(construct);
}

function namedBySpelling(flavor: Flavor, { name, check }: NamedCheck): boolean {
  const constructs = constructsOf(checked(flavor.nodes().boolean, check));
  if (name === 'describe' || name === 'meta') {
    return constructs.length === 0;
  }
  return constructs.some((construct) => namesSpelling(construct, name));
}

const numberKinds: readonly string[] = [
  'greater_than',
  'less_than',
  'multiple_of',
  'number_format',
];

function homeOf(flavor: Flavor, { check }: NamedCheck): core.$ZodType {
  const nodes = flavor.nodes();
  return numberKinds.includes(check._zod.def.check) ? nodes.number : nodes.string;
}

function nullableOf(flavor: Flavor, home: core.$ZodType): core.$ZodType {
  return flavor.name === 'zod' ? z.nullable(home) : zm.nullable(home);
}

/** A check put on a schema of a type it is not for, as `.check()` of an author's would. */
function onBoolean(check: core.$ZodCheck): core.$ZodType {
  return checked(z.boolean(), check);
}

/** The exports of `zod` and `zod/mini` that throw when called as the sweep calls them. */
const thrownExports = {
  zod: [
    'clone',
    'codec',
    'decode',
    'deepPartial',
    'discriminatedUnion',
    'encode',
    'enum',
    'flattenError',
    'formatError',
    'fromJSONSchema',
    'getDiscriminatedOption',
    'input',
    'invertCodec',
    'keyof',
    'nativeEnum',
    'output',
    'parse',
    'prettifyError',
    'safeDecode',
    'safeEncode',
    'safeParse',
    'templateLiteral',
    'toJSONSchema',
    'treeifyError',
    'union',
    'validate',
    'withParser',
    'xor',
  ],
  'zod/mini': [
    'catchall',
    'clone',
    'codec',
    'decode',
    'deepPartial',
    'discriminatedUnion',
    'encode',
    'enum',
    'exactPartial',
    'extend',
    'flattenError',
    'formatError',
    'getDiscriminatedOption',
    'input',
    'invertCodec',
    'keyof',
    'merge',
    'nativeEnum',
    'omit',
    'output',
    'parse',
    'partial',
    'pick',
    'prettifyError',
    'required',
    'safeDecode',
    'safeEncode',
    'safeExtend',
    'safeParse',
    'templateLiteral',
    'toJSONSchema',
    'treeifyError',
    'union',
    'validate',
    'withParser',
    'xor',
  ],
} as const;

/** The methods of a classic schema that throw when called as the sweep calls them. */
const thrownMethods: readonly string[] = [
  'apply',
  'clone',
  'decode',
  'encode',
  'exactPartial',
  'extend',
  'merge',
  'omit',
  'parse',
  'partial',
  'pick',
  'register',
  'required',
  'safeExtend',
  'toJSONSchema',
];

describe('a refused zod check', () => {
  test.each(flavors)(
    'every check $name builds is named by its own spelling on a boolean',
    (flavor) => {
      const { checks, thrown } = sweepExports(flavor);

      const unnamed = checks.filter((named) => !namedBySpelling(flavor, named));

      expect(unnamed.map(({ name }) => name)).toEqual([]);
      expect(checks.length).toBeGreaterThanOrEqual(77);
      expect(thrown).toEqual(thrownExports[flavor.name]);
    },
  );

  test('every check a classic zod schema method adds is named by the method on a boolean', () => {
    const { checks, called, thrown } = sweepMethods();

    const unnamed = checks.filter((named) => !namedBySpelling(zodFlavor, named));

    expect(unnamed.map(({ name }) => name)).toEqual([]);
    expect(called).toEqual(expect.arrayContaining(['gte', 'nonnegative', 'step', 'safe', 'with']));
    expect(checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['min', 'nonempty', 'step', 'safe', 'with', 'refine', 'trim']),
    );
    expect(thrown).toEqual(thrownMethods);
  });

  test.each(flavors)('no check $name builds crashes the walk of any node', (flavor) => {
    const { checks } = sweepExports(flavor);
    const problems: string[] = [];

    for (const { name, check } of checks) {
      for (const [nodeName, node] of Object.entries(flavor.nodes())) {
        try {
          const constructs = constructsOf(checked(node, check));
          problems.push(...constructs.filter((c) => c === '').map(() => `${name} on ${nodeName}`));
        } catch (error) {
          problems.push(`${name} on ${nodeName}: ${String(error)}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test.each(flavors)(
    'a check reads the same name on a boolean and on a null of its type ($name)',
    (flavor) => {
      const { checks } = sweepExports(flavor);
      const differing: string[] = [];

      for (const named of checks) {
        const home = homeOf(flavor, named);
        const onBool = constructsOf(checked(flavor.nodes().boolean, named.check));
        const onHome = constructsOf(checked(home, named.check));
        const onNull = constructsOf(checked(nullableOf(flavor, home), named.check));
        const suffixed = onBool.map((construct) => `${construct} on a schema that admits null`);
        const expectedOnNull = onHome.length === 0 ? suffixed : onBool;
        const same = JSON.stringify(onNull) === JSON.stringify(expectedOnNull);
        const sameOnHome = onHome.length === 0 || JSON.stringify(onHome) === JSON.stringify(onBool);
        if (!(same && sameOnHome)) {
          differing.push(named.name);
        }
      }

      expect(differing).toEqual([]);
    },
  );

  test.each([
    ['a set .min()', z.set(z.string()).min(1), ['z.set()', '.min(), .nonempty() or z.minSize()']],
    [
      'a date .min()',
      z.date().min(new Date(0)),
      ['z.date()', '.min(), .gte(), .nonnegative() or z.minimum()'],
    ],
    [
      'a bigint .gte()',
      z.bigint().gte(1n),
      ['z.bigint()', '.min(), .gte(), .nonnegative() or z.minimum()'],
    ],
    [
      'a nullable number z.gte()',
      checked(z.number().nullable(), z.gte(0)),
      ['.min(), .gte(), .nonnegative() or z.minimum() on a schema that admits null'],
    ],
    [
      'a nullable number z.lte()',
      checked(z.number().nullable(), z.lte(0)),
      ['.max(), .lte(), .nonpositive() or z.maximum() on a schema that admits null'],
    ],
  ])(
    "%s is named by every spelling of the check, never by zod's id",
    (_name, schema, constructs) => {
      expect(constructsOf(schema)).toEqual(constructs);
    },
  );

  test.each(['date', 'datetime', 'time', 'duration'] as const)(
    'z.iso.%s() on a number is named by that call, never as another zod function',
    (format) => {
      const check = z.iso[format]();

      expect(constructsOf(checked(z.number(), check))).toEqual([`z.iso.${format}()`]);
    },
  );

  test.each([
    ['.startsWith()', z.startsWith('a')],
    ['.endsWith()', z.endsWith('a')],
    ['.includes()', z.includes('a')],
    ['.lowercase()', z.lowercase()],
    ['.uppercase()', z.uppercase()],
  ])('%s reads the same on a boolean as on a string', (construct, check) => {
    expect(constructsOf(onBoolean(check))).toEqual([construct]);
    expect(constructsOf(checked(z.string(), check))).toEqual([construct]);
  });

  test('a regex on a boolean is named .regex()', () => {
    expect(constructsOf(onBoolean(z.regex(/a/)))).toEqual(['.regex()']);
  });

  test.each([
    [
      'z.stringFormat() of a known name',
      z.stringFormat('email', () => true),
      'z.stringFormat("email")',
    ],
    ['a custom pattern', z.email({ pattern: /x/ } as object), 'a format with a custom pattern'],
    ['z.url({ normalize })', z.url({ normalize: true }), 'z.url({ normalize })'],
    [
      'z.stringFormat() of an unknown name',
      z.stringFormat('future', /x/),
      'z.stringFormat("future")',
    ],
  ])('%s reads the same on a boolean as on a string', (_name, check, construct) => {
    expect(constructsOf(onBoolean(check))).toEqual([construct]);
    expect(constructsOf(checked(z.string(), check))).toEqual([construct]);
  });

  test.each([
    ['without a version', z.uuid(), 'z.uuid()'],
    ['of a version zod has a function for', z.uuidv4(), 'z.uuidv4() or z.uuid({ version: "v4" })'],
    [
      'of a version zod has no function for',
      z.uuid({ version: 'v1' }),
      'z.uuid({ version: "v1" })',
    ],
  ])('a uuid %s is named by the call that builds it', (_name, check, construct) => {
    expect(constructsOf(onBoolean(check))).toEqual([construct]);
  });

  test.each(flavors)(
    'z.properties() is refused as z.properties() on every node ($name)',
    (flavor) => {
      const properties = flavor.name === 'zod' ? z.properties({}) : zm.properties({});

      for (const [nodeName, node] of Object.entries(flavor.nodes())) {
        expect({ nodeName, constructs: constructsOf(checked(node, properties)) }).toEqual({
          nodeName,
          constructs: ['z.properties()'],
        });
      }
    },
  );

  test.each<NodeName>(['string', 'number', 'boolean'])(
    'a check of a kind zod adds later is refused by its kind on a %s',
    (nodeName) => {
      const future = new core.$ZodCheck({ check: 'future_kind' });

      expect(constructsOf(checked(zodFlavor.nodes()[nodeName], future))).toEqual([
        'a zod check "future_kind"',
      ]);
    },
  );

  test.each<NodeName>(['number', 'boolean'])(
    "a number format zod adds later is refused by zod's ids on a %s",
    (nodeName) => {
      const future = new core.$ZodCheck({ check: 'number_format', format: 'int8' } as never);

      expect(constructsOf(checked(zodFlavor.nodes()[nodeName], future))).toEqual([
        'a zod check "number_format" of format "int8"',
      ]);
    },
  );

  test('a zod type zod adds later is refused by its type, not as a call', () => {
    const schema = z.string();
    Object.assign(schema._zod.def, { type: 'big_decimal' });

    expect(constructsOf(schema)).toEqual(['a zod type "big_decimal"']);
  });
});
