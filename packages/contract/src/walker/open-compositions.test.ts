import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { defineEndpoint, defineEvent, defineGroup, defineService, openEnum } from '../index.ts';
import { validateRoot } from '../internal/index.ts';

/** Validates a Contract whose one Endpoint answers the body given. */
function validatedWithBody(body: core.$ZodType) {
  const echo = defineEndpoint({
    name: 'echo',
    method: 'GET',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    success: { status: 200, body },
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });
  const root = defineService({ name: 'shapes-service', groups: [group] });
  return summarized(validateRoot(root, aRootPackage(root)));
}

/** Validates a Contract whose one Endpoint takes the body given as its Input. */
function validatedWithInputBody(body: core.$ZodType) {
  const echo = defineEndpoint({
    name: 'echo',
    method: 'POST',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    input: { body },
    success: { status: 204 },
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });
  const root = defineService({ name: 'shapes-service', groups: [group] });
  return summarized(validateRoot(root, aRootPackage(root)));
}

/** Validates a Contract whose one Event carries the body given. */
function validatedWithMessageBody(body: core.$ZodType) {
  const shaped = defineEvent({
    name: 'Shaped',
    version: 1,
    visibility: 'internal',
    description: 'Shaped',
    body,
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', events: [shaped] });
  const root = defineService({ name: 'shapes-service', groups: [group] });
  return summarized(validateRoot(root, aRootPackage(root)));
}

const refusal = {
  kind: 'not-allowed',
  construct: 'an intersection that is not of open objects reaching an openEnum()',
  instead: '.extend()',
  alsoIn: [],
};

const bodyAt = 'endpoints.GET /echo (echo) success.body';

describe('validateRoot: an intersection reaching an Open Enum', () => {
  test('an intersection of an object and a discriminated union is allowed', () => {
    const payment = z.discriminatedUnion('type', [z.object({ type: z.literal('card') })]);
    const body = z.intersection(z.object({ type: z.string() }), payment);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('an intersection with an Open Enum deep inside is not allowed where it is written', () => {
    const status = z.object({ inner: z.object({ status: openEnum(['a']) }) });
    const body = z.object({
      both: z.intersection(status, z.record(z.string(), z.json())),
    });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, location: `${bodyAt}.both` }],
    });
  });

  test('an intersection reaching an Open Enum through a recursive def is not allowed', () => {
    const tree = z
      .object({
        status: openEnum(['a']),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.intersection(z.object({ root: tree }), z.record(z.string(), z.json()));

    const validated = validatedWithBody(body);

    expect(validated).toEqual({ kind: 'invalid', failures: [{ ...refusal, location: bodyAt }] });
  });

  test('an intersection inside a recursive def is not allowed once, at the first place that reaches it', () => {
    const tree = z
      .object({
        both: z.intersection(z.object({ status: openEnum(['a']) }), z.record(z.string(), z.json())),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, location: `${bodyAt}.first.both` }],
    });
  });

  test.each([
    [
      'an intersection',
      (inner: core.$ZodType) =>
        z.intersection(inner, z.union([z.object({ c: z.string() }), z.object({ d: z.string() })])),
      [
        ['union', '[0][0]'],
        ['intersection', '[0]'],
        ['intersection', ''],
      ],
    ],
    [
      'a union in an intersection',
      (inner: core.$ZodType) =>
        z.intersection(z.union([inner, z.object({ e: z.string() })]), z.object({ f: z.string() })),
      [
        ['union', '[0]<|0>[0]'],
        ['intersection', '[0]<|0>'],
        ['union', '[0]'],
        ['intersection', ''],
      ],
    ],
  ])(
    'an intersection reaching an Open Enum inside %s is reported at every depth that reaches it',
    (_outer, outerOf, inside) => {
      const options = z.union([z.object({ s: openEnum(['a']) }), z.object({ t: z.string() })]);
      const inner = z.intersection(options, z.object({ b: z.string() }));

      const validated = validatedWithBody(outerOf(inner));

      expect(validated).toEqual({
        kind: 'invalid',
        failures: inside.map(([kind, at]) => ({
          ...(kind === 'union' ? unionRefusal : refusal),
          location: `${bodyAt}${at}`,
        })),
      });
    },
  );

  test('two separate intersections reaching an Open Enum are each reported', () => {
    const open = () =>
      z.intersection(
        z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
        z.object({ b: z.string() }),
      );

    const validated = validatedWithBody(z.object({ a: open(), b: open() }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}.a[0]` },
        { ...refusal, location: `${bodyAt}.a` },
        { ...unionRefusal, location: `${bodyAt}.b[0]` },
        { ...refusal, location: `${bodyAt}.b` },
      ],
    });
  });

  test('two intersections reaching an Open Enum at different depths are each reported', () => {
    const open = () =>
      z.intersection(
        z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
        z.object({ b: z.string() }),
      );

    const validated = validatedWithBody(z.object({ a: open(), b: z.object({ c: open() }) }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}.a[0]` },
        { ...refusal, location: `${bodyAt}.a` },
        { ...unionRefusal, location: `${bodyAt}.b.c[0]` },
        { ...refusal, location: `${bodyAt}.b.c` },
      ],
    });
  });

  test('an intersection in a def is judged where it is used even when the schema using it fails the walk', () => {
    const tree = z
      .object({
        x: z.intersection(
          z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
          z.object({ b: z.string() }),
        ),
        get c() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });

    const validated = validatedWithBody(z.object({ bad: z.any(), t: tree }));

    expect(validated.kind === 'invalid' ? validated.failures : []).toEqual(
      expect.arrayContaining([
        { ...refusal, location: `${bodyAt}.t.x` },
        { ...unionRefusal, location: `${bodyAt}.t.x[0]` },
        expect.objectContaining({ location: `${bodyAt}.bad` }),
      ]),
    );
  });

  test('an intersection with no Open Enum is allowed', () => {
    const body = z.intersection(
      z.object({ status: z.enum(['a']) }),
      z.record(z.string(), z.string()),
    );

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('an Open Enum in a merged intersection of open objects is allowed', () => {
    const body = z.intersection(z.object({ status: openEnum(['a']) }), z.object({ b: z.string() }));

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });
});

const unionRefusal = {
  kind: 'not-allowed',
  construct: 'a z.union() reaching an openEnum()',
  instead: 'z.discriminatedUnion(), or one openEnum() of all the values',
  alsoIn: [],
};

const inputBodyAt = 'endpoints.POST /echo (echo) input.body';

describe('validateRoot: a plain union reaching an Open Enum', () => {
  test('an Open Enum option of a union is not allowed, at the union', () => {
    const body = z.union([openEnum(['a']), z.literal('b')]);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: bodyAt }],
    });
  });

  test.each([
    [
      'an object option',
      z.union([z.object({ t: openEnum(['a']) }), z.object({ t: z.literal('b') })]),
      [''],
    ],
    ['an array option', z.union([z.array(openEnum(['a'])), z.string()]), ['']],
    [
      'a discriminated union option',
      z.union([
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('card'), brand: openEnum(['visa']) }),
          z.object({ type: z.literal('transfer') }),
        ]),
        z.string(),
      ]),
      [''],
    ],
    ['a union option', z.union([z.union([openEnum(['a']), z.number()]), z.string()]), ['<|0>', '']],
  ])('an Open Enum inside %s is reported at every union that reaches it', (_place, body, at) => {
    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: at.map((steps) => ({ ...unionRefusal, location: `${bodyAt}${steps}` })),
    });
  });

  test('a union reaching an Open Enum through a recursive def is not allowed, at the union', () => {
    const tree = z
      .object({
        status: openEnum(['a']),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.union([tree, z.string()]);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: bodyAt }],
    });
  });

  test('a union inside a recursive def is not allowed once, at the first place that reaches it', () => {
    const tree = z
      .object({
        either: z.union([z.object({ status: openEnum(['a']) }), z.string()]),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: `${bodyAt}.first.either` }],
    });
  });

  test('a union inside an intersection is reported with the intersection', () => {
    const either = z.union([z.object({ s: openEnum(['a']) }), z.object({ t: z.string() })]);
    const body = z.intersection(either, z.object({ b: z.string() }));

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}[0]` },
        { ...refusal, location: bodyAt },
      ],
    });
  });

  test('an intersection inside a union is reported with the union', () => {
    const both = z.intersection(z.object({ s: openEnum(['a']) }), z.record(z.string(), z.json()));
    const body = z.union([both, z.object({ e: z.string() })]);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...refusal, location: `${bodyAt}<|0>` },
        { ...unionRefusal, location: bodyAt },
      ],
    });
  });

  test('two separate unions reaching an Open Enum are each reported', () => {
    const open = () => z.union([z.object({ s: openEnum(['a']) }), z.string()]);

    const validated = validatedWithBody(z.object({ a: open(), b: open() }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}.a` },
        { ...unionRefusal, location: `${bodyAt}.b` },
      ],
    });
  });

  test('a union reaching an Open Enum in an Input body is not allowed', () => {
    const body = z.union([z.object({ t: openEnum(['a']) }), z.object({ t: z.literal('b') })]);

    const validated = validatedWithInputBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: inputBodyAt }],
    });
  });

  test('a union reaching an Open Enum in a Message body is not allowed', () => {
    const choice = z.union([z.object({ t: openEnum(['a']) }), z.object({ t: z.literal('b') })]);

    const validated = validatedWithMessageBody(z.object({ choice }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          ...unionRefusal,
          location: 'events.Shaped@1 body.choice',
        },
      ],
    });
  });

  test('a discriminated union whose variants hold an Open Enum is allowed', () => {
    const body = z.discriminatedUnion('type', [
      z.object({ type: z.literal('card'), brand: openEnum(['visa']) }),
      z.object({ type: z.literal('transfer') }),
    ]);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('a union of closed values is allowed', () => {
    const body = z.union([
      z.object({ t: z.enum(['a', 'b']) }),
      z.object({ t: z.literal('c') }),
      z.string(),
    ]);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });
});
