import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import * as core from 'zod/v4/core';
import {
  asSchema,
  checked,
  type Flavor,
  flavors,
  type NamedCheck,
  type NodeName,
  sweepExports,
  sweepMethods,
  zodFlavor,
} from '../../test/zod-checks.ts';
import { refusalsIn, walkSchemas } from '../internal/index.ts';

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
      constructs.push(...refusalsIn(walked.tree).map((failure) => failure.construct));
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
    [
      'z.stringFormat() of a name every object has',
      z.stringFormat('constructor', () => true),
      'z.stringFormat("constructor")',
    ],
    ['z.hex()', z.hex(), 'z.hex() or z.stringFormat("hex")'],
    ['z.hash()', z.hash('sha256'), 'z.hash() or z.stringFormat("sha256_hex")'],
    [
      'z.stringFormat() of a regex-built name with a function',
      z.stringFormat('hostname', () => true),
      'z.hostname() or z.stringFormat("hostname")',
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

  test.each<NodeName>(['string', 'boolean'])(
    'a hex format check with no function is named by its format on a %s',
    (nodeName) => {
      const handBuilt = new core.$ZodCheckStringFormat({
        check: 'string_format',
        format: 'hex',
        pattern: z.regexes.hex,
      });

      expect(constructsOf(checked(zodFlavor.nodes()[nodeName], handBuilt))).toEqual([
        'z.stringFormat("hex")',
      ]);
    },
  );

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

  test.each(flavors)(
    'a schema that is its own check reads the name of the check ($name)',
    (flavor) => {
      const differing: string[] = [];
      let own = 0;

      for (const { name, check } of sweepExports(flavor).checks) {
        const schema = asSchema(check);
        if (schema === undefined) {
          continue;
        }
        own += 1;
        const asField = constructsOf(flavor.objectOf(schema));
        const asCheck = constructsOf(checked(flavor.nodes().boolean, check));
        if (asField.length > 0 && JSON.stringify(asField) !== JSON.stringify(asCheck)) {
          differing.push(name);
        }
      }

      expect(own).toBeGreaterThan(40);
      expect(differing).toEqual([]);
    },
  );

  test.each([
    ['z.custom()', z.custom<string>()],
    ['z.instanceof()', z.instanceof(Date)],
  ])('%s as a schema reads the spellings of the check it is', (_name, schema) => {
    const spellings = '.refine(), z.custom() or z.instanceof()';

    expect(constructsOf(z.object({ field: schema }))).toEqual([spellings]);
    expect(constructsOf(onBoolean(schema))).toEqual([spellings]);
  });

  test.each([
    ['z.int64()', z.int64()],
    ['z.uint64()', z.uint64()],
  ])('%s as a schema is named by its own call, not as z.bigint()', (name, schema) => {
    expect(constructsOf(z.object({ field: schema }))).toEqual([name]);
    expect(constructsOf(onBoolean(schema))).toEqual([name]);
  });

  test("a bigint format zod adds later reads zod's ids as a schema and as a check", () => {
    const schema = z.int64();
    Object.assign(schema._zod.def, { format: 'int128' });
    const ids = ['a zod check "bigint_format" of format "int128"'];

    expect(constructsOf(z.object({ field: schema }))).toEqual(ids);
    expect(constructsOf(onBoolean(schema))).toEqual(ids);
  });

  test('z.url() reads every call that builds a url', () => {
    expect(constructsOf(onBoolean(z.url()))).toEqual(['z.url() or z.httpUrl()']);
    expect(constructsOf(onBoolean(z.httpUrl()))).toEqual(['z.url() or z.httpUrl()']);
  });

  test('a zod type zod adds later is refused by its type, not as a call', () => {
    const schema = z.string();
    Object.assign(schema._zod.def, { type: 'big_decimal' });

    expect(constructsOf(schema)).toEqual(['a zod type "big_decimal"']);
  });
});
