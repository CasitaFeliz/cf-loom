import { runInNewContext } from 'node:vm';
import * as built from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { type SchemaNode, type StringFormat, walkSchemas } from '../internal/index.ts';

const bodyAt = {
  site: { kind: 'export', name: 'body' },
  declaration: undefined,
  steps: [],
} as const;

function walkBody(schema: core.$ZodType) {
  return refusalsOf(walkSchemas([{ at: bodyAt, schema }], () => undefined));
}

function walkedTo(node: SchemaNode) {
  return { located: [{ kind: 'walked', value: node }], defs: {} };
}

function refusedAt(at: string, construct: string, instead?: string) {
  const failure = { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
  return { located: [{ kind: 'not-allowed', failures: [failure] }], defs: {} };
}

const hexSpellings = 'z.hex() or z.stringFormat("hex")';
const sha256Spellings = 'z.hash() or z.stringFormat("sha256_hex")';
const currencySpellings = 'z.currencyCode() or z.stringFormat("currency_code")';
const plainRegex = 'a regex that is no plain RegExp';
const plainRegexInstead = 'a RegExp literal or new RegExp(), with nothing set on it';

/** `/^a$/` with one property of its own set on it. */
function regexWithOwn(key: PropertyKey, value: unknown): RegExp {
  const regex = /^a$/;
  Object.defineProperty(regex, key, { value, configurable: true });
  return regex;
}

/** A Proxy whose every trap throws, so any read of it would. */
function throwingProxy(): RegExp {
  const trap = () => {
    throw new Error('a trap ran');
  };
  const traps = { get: trap, getPrototypeOf: trap, ownKeys: trap, has: trap };
  return new Proxy(/^a$/, { ...traps, getOwnPropertyDescriptor: trap, defineProperty: trap });
}

/** A read a Proxy forwards to its RegExp, so the RegExp's own getters see the RegExp. */
function forwardedRead(target: RegExp, key: PropertyKey): unknown {
  return Reflect.get(target, key, target);
}

class OverridingRegExp extends RegExp {
  override test(): boolean {
    return true;
  }
}

class SubRegExp extends RegExp {}

describe('walkSchemas: strings', () => {
  test('a string is a string node', () => {
    expect(walkBody(z.string())).toEqual(walkedTo({ type: 'string' }));
  });

  test('min and max length are min and max', () => {
    const name = z.string().min(1).max(50);

    expect(walkBody(name)).toEqual(walkedTo({ type: 'string', min: 1, max: 50 }));
  });

  test('an exact length is min equal to max', () => {
    expect(walkBody(z.string().length(3))).toEqual(walkedTo({ type: 'string', min: 3, max: 3 }));
  });

  test('a format schema is a string with its format', () => {
    expect(walkBody(z.uuid())).toEqual(walkedTo({ type: 'string', format: 'uuid' }));
  });

  test('a format written as a check is the same string with its format', () => {
    expect(walkBody(z.string().email())).toEqual(walkedTo({ type: 'string', format: 'email' }));
  });

  test('a format carries the options it declares', () => {
    const placedAt = z.iso.datetime({ offset: true, precision: 3 });

    expect(walkBody(placedAt)).toEqual(
      walkedTo({
        type: 'string',
        format: 'datetime',
        formatOptions: { offset: true, precision: 3 },
      }),
    );
  });

  test.each<[string, core.$ZodType, StringFormat]>([
    ['z.guid()', z.guid(), 'guid'],
    ['z.cuid()', z.cuid(), 'cuid'],
    ['z.ipv4()', z.ipv4(), 'ipv4'],
    ['z.iso.date()', z.iso.date(), 'date'],
    ['z.mac()', z.mac(), 'mac'],
    ['z.mac() with the default delimiter', z.mac({ delimiter: ':' }), 'mac'],
    ['z.iso.datetime() with the default offset', z.iso.datetime({ offset: false }), 'datetime'],
    ['a zod/mini z.uuid()', zm.uuid(), 'uuid'],
  ])('%s is its format with no options', (_name, schema, format) => {
    expect(walkBody(schema)).toEqual(walkedTo({ type: 'string', format }));
  });

  test.each([
    ['z.url({ normalize: false })', z.url({ normalize: false })],
    ['z.url() with a key zod does not read', z.url({ params: { note: 'x' } } as object)],
  ])('%s is a url with no options', (_name, schema) => {
    expect(walkBody(schema)).toEqual(walkedTo({ type: 'string', format: 'url' }));
  });

  test('z.jwt() with a key zod does not read is a jwt with no options', () => {
    expect(walkBody(z.jwt({ foo: 'bar' } as object))).toEqual(
      walkedTo({ type: 'string', format: 'jwt' }),
    );
  });

  test('a zod/mini format keeps the options it declares', () => {
    expect(walkBody(zm.uuid({ version: 'v4' }))).toEqual(
      walkedTo({ type: 'string', format: 'uuid', formatOptions: { version: 'v4' } }),
    );
  });

  test.each<{ name: string; schema: core.$ZodType; construct: string; regexName: string }>([
    { name: 'z.hex()', schema: z.hex(), construct: hexSpellings, regexName: 'hex' },
    {
      name: 'z.hostname()',
      schema: z.hostname(),
      construct: 'z.hostname() or z.stringFormat("hostname")',
      regexName: 'hostname',
    },
    {
      name: 'z.currencyCode()',
      schema: z.currencyCode(),
      construct: currencySpellings,
      regexName: 'currencyCode',
    },
    {
      name: 'z.hash()',
      schema: z.hash('sha256'),
      construct: sha256Spellings,
      regexName: 'sha256_hex',
    },
    {
      name: 'z.hash() with an encoding',
      schema: z.hash('md5', { enc: 'base64url' }),
      construct: 'z.hash() or z.stringFormat("md5_base64url")',
      regexName: 'md5_base64url',
    },
    { name: 'zm.hex()', schema: zm.hex(), construct: hexSpellings, regexName: 'hex' },
    {
      name: 'zm.hostname()',
      schema: zm.hostname(),
      construct: 'z.hostname() or z.stringFormat("hostname")',
      regexName: 'hostname',
    },
    {
      name: 'zm.currencyCode()',
      schema: zm.currencyCode(),
      construct: currencySpellings,
      regexName: 'currencyCode',
    },
    {
      name: 'zm.hash()',
      schema: zm.hash('sha256'),
      construct: sha256Spellings,
      regexName: 'sha256_hex',
    },
    {
      name: 'z.stringFormat() with zod’s own regex',
      schema: z.stringFormat('hex', z.regexes.hex),
      construct: hexSpellings,
      regexName: 'hex',
    },
    {
      name: 'z.stringFormat() with another regex',
      schema: z.stringFormat('hex', /^[a-f]+$/),
      construct: hexSpellings,
      regexName: 'hex',
    },
    {
      name: 'z.stringFormat() with a function',
      schema: z.stringFormat('hex', (value) => value === 'secret'),
      construct: hexSpellings,
      regexName: 'hex',
    },
    {
      name: 'z.stringFormat() of a hash name with a function',
      schema: z.stringFormat('sha256_hex', () => true),
      construct: sha256Spellings,
      regexName: 'sha256_hex',
    },
    {
      name: 'z.stringFormat() of a currency code with a function',
      schema: z.stringFormat('currency_code', () => true),
      construct: currencySpellings,
      regexName: 'currencyCode',
    },
  ])(
    '$name, whose check zod runs through a function, fails with its z.regexes pattern instead',
    ({ schema, construct, regexName }) => {
      const refused = refusedAt('', construct, `.regex(z.regexes.${regexName})`);

      expect(walkBody(schema)).toEqual(refused);
      expect(refusalsOf(built.walkSchemas([{ at: bodyAt, schema }], () => undefined))).toEqual(
        refused,
      );
    },
  );

  test('a copy of zod’s hex check that tests another regex fails', () => {
    const fnOrRegex = /^ff$/;
    const hex = z.stringFormat('hex', (val) => fnOrRegex.test(val), {
      pattern: z.regexes.hex,
    } as object);

    expect(walkBody(hex)).toEqual(refusedAt('', hexSpellings, '.regex(z.regexes.hex)'));
  });

  test.each<[string, core.$ZodType]>([
    [
      'with a function and a pattern beside it',
      z.stringFormat('regex', (value) => value === 'secret', { pattern: /^.*$/ } as object),
    ],
    ['with a regex, which zod tests through a function', z.stringFormat('regex', /^a$/)],
  ])('z.stringFormat("regex") %s fails', (_name, schema) => {
    expect(walkBody(schema)).toEqual(refusedAt('', 'z.stringFormat("regex")'));
  });

  test.each<[string, core.$ZodType]>([
    ['.regex()', z.string().regex(/^a$/)],
    ['a zod/mini regex check', zm.string().check(zm.regex(/^a$/))],
  ])('%s walks to its regex', (_name, schema) => {
    expect(walkBody(schema)).toEqual(
      walkedTo({ type: 'string', regex: { source: '^a$', flags: '' } }),
    );
  });

  test('.regex(z.regexes.hex) walks to zod’s hex pattern', () => {
    expect(walkBody(z.string().regex(z.regexes.hex))).toEqual(
      walkedTo({ type: 'string', regex: { source: '^[0-9a-fA-F]*$', flags: '' } }),
    );
  });

  /**
   * Every format SNAPSHOT.md knows, with the zod call that builds it, so a format added to it is
   * checked here too; each keeps a `pattern` its parameter types leave out.
   */
  const knownFormats: Record<StringFormat, (params?: object) => core.$ZodType> = {
    guid: z.guid,
    uuid: z.uuid,
    email: z.email,
    url: z.url,
    emoji: z.emoji,
    nanoid: z.nanoid,
    cuid: z.cuid,
    cuid2: z.cuid2,
    ulid: z.ulid,
    xid: z.xid,
    ksuid: z.ksuid,
    datetime: z.iso.datetime,
    date: z.iso.date,
    time: z.iso.time,
    duration: z.iso.duration,
    ipv4: z.ipv4,
    ipv6: z.ipv6,
    mac: z.mac,
    cidrv4: z.cidrv4,
    cidrv6: z.cidrv6,
    base64: z.base64,
    base64url: z.base64url,
    e164: z.e164,
    // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
    credit_card: z.creditCard,
    iban: z.iban,
    jwt: z.jwt,
  };

  /** The formats whose def holds a pattern, each with zod's own pattern for it. */
  const patternedFormats: {
    format: string;
    build: (params: object) => core.$ZodType;
    pattern: RegExp;
  }[] = [];
  for (const [format, build] of Object.entries(knownFormats)) {
    const { pattern } = build()._zod.def as { pattern?: RegExp };
    if (pattern !== undefined) {
      patternedFormats.push({ format, build, pattern });
    }
  }

  test.each(patternedFormats)(
    'a $format whose pattern is a copy of zod’s with its own test fails as no plain RegExp',
    ({ build, pattern }) => {
      const copy = new RegExp(pattern.source, pattern.flags);
      copy.test = () => true;

      expect(walkBody(build({ pattern: copy }))).toEqual(
        refusedAt('', plainRegex, plainRegexInstead),
      );
    },
  );

  test.each([...Object.keys(knownFormats), 'regex'])(
    'a z.stringFormat("%s") whose check is a function fails, whatever pattern sits beside it',
    (format) => {
      const schema = z.stringFormat(format, () => true, { pattern: /^.*$/ } as object);

      expect(walkBody(schema)).toEqual(refusedAt('', `z.stringFormat(${JSON.stringify(format)})`));
    },
  );

  test('the built package walks a format like the source', () => {
    const placedAt = z.iso.datetime({ offset: true, precision: 3 });

    const walked = built.walkSchemas([{ at: bodyAt, schema: placedAt }], () => undefined);

    expect(refusalsOf(walked)).toEqual(walkBody(placedAt));
  });

  test('an option that differs from zod default is a format option', () => {
    expect(walkBody(z.uuid({ version: 'v4' }))).toEqual(
      walkedTo({ type: 'string', format: 'uuid', formatOptions: { version: 'v4' } }),
    );
  });

  test('a format with its length bounds keeps both', () => {
    expect(walkBody(z.email().max(100))).toEqual(
      walkedTo({ type: 'string', format: 'email', max: 100 }),
    );
  });

  test('a regex stores its source and flags', () => {
    const code = z.string().regex(/^[a-z]+$/iu);

    expect(walkBody(code)).toEqual(
      walkedTo({ type: 'string', regex: { source: '^[a-z]+$', flags: 'iu' } }),
    );
  });

  test('.brand() changes no shape, so a branded string is a string', () => {
    expect(walkBody(z.string().brand<'OrderId'>())).toEqual(walkedTo({ type: 'string' }));
  });

  test('a zod/mini string with checks walks like a zod one', () => {
    const name = zm.string().check(zm.minLength(1), zm.maxLength(50));

    expect(walkBody(name)).toEqual(walkedTo({ type: 'string', min: 1, max: 50 }));
  });
});

describe('walkSchemas: regexes zod tests', () => {
  test.each<[string, unknown]>([
    ['an own test', regexWithOwn('test', () => true)],
    ['an own exec', regexWithOwn('exec', () => ['x'])],
    ['an own source', regexWithOwn('source', '^b$')],
    ['an own flags', regexWithOwn('flags', 'i')],
    ['an own Symbol.match', regexWithOwn(Symbol.match, () => null)],
    ['any other own property', regexWithOwn('note', 1)],
    ['a subclass overriding test', new OverridingRegExp('^a$')],
    ['a subclass overriding nothing', new SubRegExp('^a$')],
    ['a RegExp of another realm', runInNewContext('/^a$/')],
    ['a regex-like object', { source: '^a$', flags: '', test: () => true }],
    ['a string', '^a$'],
    ['a Proxy around a RegExp', new Proxy(/^a$/, {})],
    ['a Proxy whose every trap throws', throwingProxy()],
    ['a Proxy that forwards reads to a RegExp', new Proxy(/^a$/, { get: forwardedRead })],
    ['a frozen RegExp, whose lastIndex zod cannot reset', Object.freeze(/^a$/)],
  ])('.regex() given %s fails as no plain RegExp', (_name, regex) => {
    const schema = z.string().regex(regex as RegExp);

    expect(walkBody(schema)).toEqual(refusedAt('', plainRegex, plainRegexInstead));
  });

  test('judging a Proxy around a RegExp runs none of its traps', () => {
    const trapsRun: string[] = [];
    const recording = new Proxy(/^a$/, {
      get: (target, key) => {
        trapsRun.push(`get ${String(key)}`);
        return forwardedRead(target, key);
      },
      getPrototypeOf: (target) => {
        trapsRun.push('getPrototypeOf');
        return Reflect.getPrototypeOf(target);
      },
      ownKeys: (target) => {
        trapsRun.push('ownKeys');
        return Reflect.ownKeys(target);
      },
    });
    const schema = z.string().regex(recording);
    trapsRun.length = 0;

    walkBody(schema);

    expect(trapsRun).toEqual([]);
  });

  test('a zod/mini regex check with its own test fails as no plain RegExp', () => {
    const schema = zm.string().check(zm.regex(regexWithOwn('test', () => true)));

    expect(walkBody(schema)).toEqual(refusedAt('', plainRegex, plainRegexInstead));
  });

  test('a regex that is no plain RegExp is refused at the field that holds it', () => {
    const order = z.object({ code: z.string().regex(regexWithOwn('test', () => true)) });

    expect(walkBody(order)).toEqual(refusedAt('code', plainRegex, plainRegexInstead));
  });

  test.each<[string, RegExp]>([
    ['a RegExp literal', /^a$/],
    ['new RegExp() of a literal', new RegExp(/^a$/)],
    ['a sealed RegExp', Object.seal(/^a$/)],
    ['a non-extensible RegExp', Object.preventExtensions(/^a$/)],
  ])('%s walks to its source and flags', (_name, regex) => {
    expect(walkBody(z.string().regex(regex))).toEqual(
      walkedTo({ type: 'string', regex: { source: '^a$', flags: '' } }),
    );
  });

  test('a global RegExp walks to its source and flags', () => {
    expect(walkBody(z.string().regex(/^a$/g))).toEqual(
      walkedTo({ type: 'string', regex: { source: '^a$', flags: 'g' } }),
    );
  });

  test('z.email() given a copy of zod’s pattern with its own test fails as no plain RegExp', () => {
    const pattern = new RegExp(z.regexes.email.source, z.regexes.email.flags);
    pattern.test = () => true;

    expect(walkBody(z.email({ pattern }))).toEqual(refusedAt('', plainRegex, plainRegexInstead));
  });

  test('a format whose zod pattern was given its own test fails as no plain RegExp', () => {
    z.regexes.email.test = () => true;
    try {
      expect(walkBody(z.email())).toEqual(refusedAt('', plainRegex, plainRegexInstead));
    } finally {
      Reflect.deleteProperty(z.regexes.email, 'test');
    }
  });

  test('a plain copy of a zod pattern that was given its own test fails as a custom pattern', () => {
    const pattern = new RegExp(z.regexes.email.source, z.regexes.email.flags);
    z.regexes.email.test = () => true;
    try {
      expect(walkBody(z.email({ pattern }))).toEqual(
        refusedAt('', 'a format with a custom pattern'),
      );
    } finally {
      Reflect.deleteProperty(z.regexes.email, 'test');
    }
  });

  const notPlainRegexes: [string, unknown][] = [
    ['a regex with its own test', regexWithOwn('test', () => true)],
    ['a regex-like object', { source: '^a$', flags: '', test: () => true }],
    ['a string', '^a$'],
  ];

  test.each(
    ['hostname', 'protocol'].flatMap((option) =>
      notPlainRegexes.map(([name, regex]) => [option, name, regex] as const),
    ),
  )('z.url() given as %s %s fails as no plain RegExp', (option, _name, regex) => {
    const schema = z.url({ [option]: regex });

    expect(walkBody(schema)).toEqual(refusedAt('', plainRegex, plainRegexInstead));
  });

  test('z.url() given a plain hostname walks to it', () => {
    expect(walkBody(z.url({ hostname: /^a\.com$/ }))).toEqual(
      walkedTo({
        type: 'string',
        format: 'url',
        formatOptions: { hostname: { source: '^a\\.com$', flags: '' } },
      }),
    );
  });

  test('z.httpUrl() walks to the protocol and hostname zod gives it', () => {
    expect(walkBody(z.httpUrl())).toEqual(
      walkedTo({
        type: 'string',
        format: 'url',
        formatOptions: {
          protocol: { source: z.regexes.httpProtocol.source, flags: '' },
          hostname: { source: z.regexes.domain.source, flags: '' },
        },
      }),
    );
  });

  test.each<[string, (regex: RegExp) => core.$ZodType]>([
    [
      'on the schema itself',
      (regex) =>
        z
          .string()
          .regex(regex)
          .meta({ examples: ['zzz'] }),
    ],
    [
      'on an object whose field holds it',
      (regex) => z.object({ code: z.string().regex(regex) }).meta({ examples: [{ code: 'zzz' }] }),
    ],
  ])('a refused regex’s own test never runs when examples sit %s', (_name, schemaOf) => {
    const regex = regexWithOwn('test', () => {
      throw new Error('the regex’s own test ran');
    });

    const walk = () => walkBody(schemaOf(regex));

    expect(walk).not.toThrow();
  });
});

describe('walkSchemas: numbers', () => {
  test('a number is a number node', () => {
    expect(walkBody(z.number())).toEqual(walkedTo({ type: 'number' }));
  });

  test('inclusive bounds are min and max', () => {
    expect(walkBody(z.number().min(0).max(10))).toEqual(
      walkedTo({ type: 'number', min: 0, max: 10 }),
    );
  });

  test('exclusive bounds are exclusiveMin and exclusiveMax', () => {
    expect(walkBody(z.number().gt(0).lt(10))).toEqual(
      walkedTo({ type: 'number', exclusiveMin: 0, exclusiveMax: 10 }),
    );
  });

  test('multipleOf is multipleOf', () => {
    expect(walkBody(z.number().multipleOf(5))).toEqual(walkedTo({ type: 'number', multipleOf: 5 }));
  });

  test('z.int() is int and writes no safe-integer bounds', () => {
    expect(walkBody(z.int())).toEqual(walkedTo({ type: 'number', int: true }));
  });

  test('.int() on a number is int', () => {
    expect(walkBody(z.number().int().min(1))).toEqual(
      walkedTo({ type: 'number', int: true, min: 1 }),
    );
  });

  test('a zod/mini int walks like a zod one', () => {
    expect(walkBody(zm.int())).toEqual(walkedTo({ type: 'number', int: true }));
  });
});

describe('walkSchemas: booleans, literals and JSON', () => {
  test('a boolean is a boolean node', () => {
    expect(walkBody(z.boolean())).toEqual(walkedTo({ type: 'boolean' }));
  });

  test('a literal is a closed enum of its one value', () => {
    expect(walkBody(z.literal('a'))).toEqual(
      walkedTo({ type: 'enum', values: ['a'], open: false }),
    );
  });

  test.each([
    ['a string', 'a'],
    ['an integer', 2],
    ['a non-integer', 1.5],
    ['true', true],
    ['false', false],
  ])(
    'a literal of %s, alone, as a list of one or as a union of one, is one closed enum',
    (_kind, value) => {
      const one = walkBody(z.literal(value));
      const listed = walkBody(z.literal([value]));
      const union = walkBody(z.union([z.literal(value)]));

      expect(one).toEqual(walkedTo({ type: 'enum', values: [value], open: false }));
      expect(listed).toEqual(one);
      expect(union).toEqual(one);
    },
  );

  test('a literal and an enum of the same string walk to the same node', () => {
    expect(walkBody(z.enum(['a']))).toEqual(walkBody(z.literal('a')));
  });

  test('a literal of several values is an enum of them', () => {
    expect(walkBody(z.literal(['b', 'a']))).toEqual(
      walkedTo({ type: 'enum', values: ['a', 'b'], open: false }),
    );
  });

  test('a literal of several values holds each value once', () => {
    expect(walkBody(z.literal(['a', 'a']))).toEqual(
      walkedTo({ type: 'enum', values: ['a'], open: false }),
    );
  });

  test('z.json() is any JSON value', () => {
    expect(walkBody(z.json())).toEqual(walkedTo({ type: 'json' }));
  });

  test('a zod/mini z.json() is any JSON value', () => {
    expect(walkBody(zm.json())).toEqual(walkedTo({ type: 'json' }));
  });
});
