import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
} from '../index.ts';
import { validateContract } from '../internal/index.ts';

/** The schemas a Contract's one Endpoint, its Guard and its Rejection declare, each optional. */
type Declared = {
  readonly inputBody?: core.$ZodType;
  readonly successBody?: core.$ZodType;
  readonly rejectionBody?: core.$ZodType;
  readonly context?: core.$ZodType;
  readonly qualifier?: core.$ZodType;
};

/** A Contract whose one Endpoint attaches one Guard and answers one Rejection. */
function contractWith(declared: Declared) {
  const gate = defineGuard({
    name: 'gate',
    description: 'Gate',
    ...(declared.context && { context: declared.context }),
    ...(declared.qualifier && { qualifier: declared.qualifier }),
  } as never);
  const denied = defineRejection({
    code: 'DENIED',
    status: 403,
    message: 'Denied',
    ...(declared.rejectionBody && { body: declared.rejectionBody }),
  });
  const echo = defineEndpoint({
    name: 'echo',
    method: 'POST',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    guards: [declared.qualifier === undefined ? gate : { guard: gate, qualifier: { eur: 1 } }],
    ...(declared.inputBody && { input: { body: declared.inputBody } }),
    success: {
      status: declared.successBody === undefined ? 204 : 200,
      ...(declared.successBody && { body: declared.successBody }),
    },
    rejections: [denied],
  } as never);
  const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });
  return defineContract({ name: 'shapes-service', groups: [group] });
}

function failuresIn(root: unknown) {
  const validated = validateContract(root, {
    originOf: () => undefined,
    packageName: 'shapes-service',
    exportsOf: () => [],
  });
  return validated.kind === 'invalid' ? validated.failures : [];
}

const endpointAt = ['groups', 'shapes', 'endpoints', 'POST /echo'];
const refusal = {
  kind: 'not-allowed',
  construct: 'a record keyed by an enum or literal in a Read shape',
  instead: 'z.object() or a string-keyed z.record()',
};

const records = [
  ['a literal-keyed record', () => z.record(z.literal('eur'), z.number())],
  ['a partial record', () => z.partialRecord(z.enum(['eur', 'usd']), z.number())],
  ['an enum-keyed record of one key', () => z.record(z.enum(['eur']), z.number())],
] as const;

describe('validateContract: a record keyed by an enum or literal in a Read shape', () => {
  test.each(records)('%s fails in a Success body', (_kind, record) => {
    const failures = failuresIn(contractWith({ successBody: record() }));

    expect(failures).toEqual([{ ...refusal, at: [...endpointAt, 'success', 'body'] }]);
  });

  test.each(records)('%s fails in a Rejection body', (_kind, record) => {
    const failures = failuresIn(contractWith({ rejectionBody: record() }));

    expect(failures).toEqual([{ ...refusal, at: ['rejections', 'DENIED', 'body'] }]);
  });

  test.each(records)('%s fails nested in a Success body, where it is written', (_kind, record) => {
    const body = z.object({ totals: z.array(z.object({ byCurrency: record() })) });

    const failures = failuresIn(contractWith({ successBody: body }));

    expect(failures).toEqual([
      {
        ...refusal,
        at: [...endpointAt, 'success', 'body', 'fields', 'totals', 'items', 'fields', 'byCurrency'],
      },
    ]);
  });

  test('a record in a recursive def a Success reaches fails once, where the def is', () => {
    const tree = z
      .object({
        totals: z.record(z.enum(['eur']), z.number()),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const failures = failuresIn(contractWith({ successBody: body }));

    expect(failures).toEqual([{ ...refusal, at: ['defs', 'tree', 'fields', 'totals'] }]);
  });

  test('a record in a recursive def two Read shapes reach fails once, where the def is', () => {
    const tree = z
      .object({
        totals: z.record(z.enum(['eur']), z.number()),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });

    const failures = failuresIn(
      contractWith({ successBody: z.object({ tree }), rejectionBody: z.object({ tree }) }),
    );

    expect(failures).toEqual([{ ...refusal, at: ['defs', 'tree', 'fields', 'totals'] }]);
  });

  test('a record in a recursive def reached only through another def fails', () => {
    const leaf = z
      .object({
        totals: z.record(z.enum(['eur']), z.number()),
        get next() {
          return leaf.optional();
        },
      })
      .meta({ id: 'leaf' });
    const branch = z
      .object({
        leaf,
        get next() {
          return branch.optional();
        },
      })
      .meta({ id: 'branch' });

    const failures = failuresIn(contractWith({ successBody: z.object({ branch }) }));

    expect(failures).toEqual([{ ...refusal, at: ['defs', 'leaf', 'fields', 'totals'] }]);
  });

  test('a shared schema of a Definitions Package fails where a Service uses it in a Read shape', () => {
    const totals = z.record(z.enum(['eur']), z.number());
    const definitions = defineDefinitions({ name: 'definitions', schemas: { totals } });

    const failures = failuresIn(
      contractWith({ successBody: z.object({ totals: definitions.schemas.totals }) }),
    );

    expect(failures).toEqual([
      { ...refusal, at: [...endpointAt, 'success', 'body', 'fields', 'totals'] },
    ]);
  });

  test('a shared schema of a Definitions Package is allowed in its own root', () => {
    const totals = z.record(z.enum(['eur']), z.number());
    const definitions = defineDefinitions({ name: 'definitions', schemas: { totals } });

    const validated = validateContract(definitions, {
      originOf: () => undefined,
      packageName: 'definitions',
      exportsOf: () => [],
    });

    expect(validated.kind).toBe('valid');
  });

  test.each(records)(
    '%s is allowed in an Input body, a Context and a Qualifier',
    (_kind, record) => {
      const declared = { inputBody: record(), context: record(), qualifier: record() };

      const failures = failuresIn(contractWith(declared));

      expect(failures).toEqual([]);
    },
  );

  test('a recursive def an Input reaches keeps its record', () => {
    const tree = z
      .object({
        totals: z.record(z.enum(['eur']), z.number()),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });

    const failures = failuresIn(contractWith({ inputBody: z.object({ tree }) }));

    expect(failures).toEqual([]);
  });

  test('a string-keyed record is allowed in every position', () => {
    const record = () => z.record(z.string(), z.number());
    const declared = {
      inputBody: record(),
      successBody: record(),
      rejectionBody: record(),
      context: record(),
      qualifier: record(),
    };

    const failures = failuresIn(contractWith(declared));

    expect(failures).toEqual([]);
  });
});
