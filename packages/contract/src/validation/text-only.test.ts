import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
  openEnum,
} from '../index.ts';
import { type OriginOf, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: OriginOf) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packageName = typeof name === 'string' ? name : '';
  return validateContract(root, { originOf, packageName, exportsOf: () => [] });
}

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

/** A headers object whose names the types cannot judge, as a cast lets an author write it. */
function headersOf(shape: Record<string, core.$ZodType>) {
  return z.object(shape) as z.ZodObject;
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(
    defineContract({ name: 'orders-service', groups: [orders] }),
    () => undefined,
  );
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

const endpointAt = ['groups', 'orders', 'endpoints', 'GET /orders'];
const text = 'travels as text: a string, number, boolean, literal or enum';

describe('validateContract: text-only headers, query and path params', () => {
  test('strings, numbers, booleans, literals and enums validate in every text part', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId/items/:itemId',
      input: {
        params: z.object({ orderId: z.uuid(), itemId: z.int() }),
        query: z.object({
          page: z.int().optional(),
          dryRun: z.boolean(),
          kind: z.literal('all'),
          status: openEnum(['pending', 'paid']),
          ids: z.array(z.uuid()),
        }),
        headers: z.object({ 'x-tenant': z.string(), 'x-retries': z.number() }),
      },
      success: { ...listing.success, headers: z.object({ 'x-total': z.int() }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a header that is an object fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-client': z.object({ id: z.string() }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'headers', 'fields', 'x-client'],
        'not-text',
        `A header ${text}: x-client`,
      ),
    );
  });

  test('a header that is a list fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-tags': z.array(z.string()) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'headers', 'fields', 'x-tags'],
        'not-text',
        `A header ${text}: x-tags`,
      ),
    );
  });

  test('a Success header that is an object fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: { ...listing.success, headers: z.object({ 'x-page': z.object({ next: z.int() }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'success', 'headers', 'fields', 'x-page'],
        'not-text',
        `A header ${text}: x-page`,
      ),
    );
  });

  test('a query param that is an object fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ filter: z.object({ status: z.string() }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'query', 'fields', 'filter'],
        'not-text',
        `A query param ${text}, or a list of those: filter`,
      ),
    );
  });

  test('a query param that is a list of objects fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ filters: z.array(z.object({ status: z.string() })) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'query', 'fields', 'filters'],
        'not-text',
        `A query param ${text}, or a list of those: filters`,
      ),
    );
  });

  test('a path param that is a list fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.array(z.string()) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'input', 'params', 'fields', 'orderId'],
        'not-text',
        `A path param ${text}: orderId`,
      ),
    );
  });

  test('a nullable query param fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ page: z.int().nullable() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'query', 'fields', 'page'],
        'nullable-text',
        'A query param is never nullable: page',
      ),
    );
  });

  test('a nullable path param fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid().nullable() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'input', 'params', 'fields', 'orderId'],
        'nullable-text',
        'A path param is never nullable: orderId',
      ),
    );
  });

  test('a nullable header fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-tenant': z.string().nullable() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'headers', 'fields', 'x-tenant'],
        'nullable-text',
        'A header is never nullable: x-tenant',
      ),
    );
  });

  test('a Guard’s demanded header that is an object fails', () => {
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { headers: z.object({ 'x-signature': z.object({ alg: z.string() }) }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        ['guards', 'signed', 'demands', 'headers', 'fields', 'x-signature'],
        'not-text',
        `A header ${text}: x-signature`,
      ),
    );
  });

  test('a headers part that is not an object fails', () => {
    const headers = z.string() as unknown as z.ZodObject;

    expect(validateEndpoint(defineEndpoint({ ...listing, input: { headers } }))).toEqual(
      failed(
        [...endpointAt, 'input', 'headers'],
        'not-an-object-schema',
        'headers is an object of its fields',
      ),
    );
  });
});

describe('validateContract: a text part that is itself nullable', () => {
  test('a nullable headers object fails', () => {
    const headers = z.object({ 'x-tenant': z.string() }).nullable() as unknown as z.ZodObject;

    expect(validateEndpoint(defineEndpoint({ ...listing, input: { headers } }))).toEqual(
      failed([...endpointAt, 'input', 'headers'], 'nullable-text', 'headers is never nullable'),
    );
  });

  test('a nullable query object fails', () => {
    const query = z.object({ page: z.int() }).nullable() as unknown as z.ZodObject;

    expect(validateEndpoint(defineEndpoint({ ...listing, input: { query } }))).toEqual(
      failed([...endpointAt, 'input', 'query'], 'nullable-text', 'query is never nullable'),
    );
  });
});

describe('validateContract: header names', () => {
  test('an upper-case Input header name fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: headersOf({ 'X-Tenant': z.string() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'headers', 'fields', 'X-Tenant'],
        'header-names',
        'Header names are lower-case: X-Tenant',
      ),
    );
  });

  test('an upper-case Success header name fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: { ...listing.success, headers: headersOf({ 'Content-Location': z.string() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'success', 'headers', 'fields', 'Content-Location'],
        'header-names',
        'Header names are lower-case: Content-Location',
      ),
    );
  });

  test('an upper-case demanded header name fails', () => {
    const apiKey = defineGuard({
      name: 'apiKey',
      description: 'A key',
      demands: { headers: headersOf({ 'X-Api-Key': z.string() }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [apiKey] }))).toEqual(
      failed(
        ['guards', 'apiKey', 'demands', 'headers', 'fields', 'X-Api-Key'],
        'header-names',
        'Header names are lower-case: X-Api-Key',
      ),
    );
  });
});

describe('validateContract: one schema per header or query name on an Endpoint', () => {
  const userToken = defineGuard({
    name: 'userToken',
    description: 'A signed-in user',
    demands: {
      headers: z.object({ authorization: z.string() }),
      query: z.object({ tenant: z.string().optional() }),
    },
  });

  test('an Endpoint and its Guard declaring one header alike validate', () => {
    const endpoint = defineEndpoint({
      ...listing,
      guards: [userToken],
      input: {
        headers: z.object({ authorization: z.string().optional() }),
        query: z.object({ tenant: z.string() }),
      },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('an Endpoint and its Guard declaring one header with different schemas fail', () => {
    const endpoint = defineEndpoint({
      ...listing,
      guards: [userToken],
      input: { headers: z.object({ authorization: z.jwt() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'headers'],
        'input-conflict',
        'A header has one schema across an Endpoint and its Guards: authorization differs between listOrders and userToken',
      ),
    );
  });

  test('an Endpoint and its Guard declaring one header with different annotations agree', () => {
    const endpoint = defineEndpoint({
      ...listing,
      guards: [userToken],
      input: { headers: z.object({ authorization: z.string().describe('A bearer token') }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('two Guards declaring one query param with different schemas fail', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      demands: { query: z.object({ tenant: z.uuid() }) },
    });
    const endpoint = defineEndpoint({ ...listing, guards: [userToken, tenant] });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        [...endpointAt, 'input', 'query'],
        'input-conflict',
        'A query param has one schema across an Endpoint and its Guards: tenant differs between userToken and tenant',
      ),
    );
  });
});

describe('validateContract: a record keyed by an enum or literal as query or headers', () => {
  const keyed = () => z.record(z.enum(['tenant']), z.string()) as unknown as z.ZodObject;
  const refusal = {
    kind: 'not-allowed',
    construct: 'a record keyed by an enum or literal as query or headers',
    instead: 'z.object()',
  };

  test.each([
    ['an Endpoint’s query', { input: { query: keyed() } }, [...endpointAt, 'input', 'query']],
    ['an Endpoint’s headers', { input: { headers: keyed() } }, [...endpointAt, 'input', 'headers']],
    [
      'Success headers',
      { success: { ...listing.success, headers: keyed() } },
      [...endpointAt, 'success', 'headers'],
    ],
  ])('a keyed record as %s fails', (_part, declared, at) => {
    const validated = validateEndpoint(defineEndpoint({ ...listing, ...declared } as never));

    expect(validated).toEqual({ kind: 'invalid', failures: [{ ...refusal, at }] });
  });

  test.each([
    ['query', { query: keyed() }],
    ['headers', { headers: keyed() }],
  ])('a keyed record a Guard demands as %s fails', (part, demands) => {
    const tenant = defineGuard({ name: 'tenant', description: 'A tenant', demands });

    const validated = validateEndpoint(defineEndpoint({ ...listing, guards: [tenant] }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, at: ['guards', 'tenant', 'demands', part] }],
    });
  });

  test('a keyed record as query fails whether the Endpoint or only its Guard declares it', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      demands: { query: keyed() },
    });
    const endpoint = defineEndpoint({
      ...listing,
      guards: [tenant],
      input: { query: keyed() },
    } as never);

    const validated = validateEndpoint(endpoint);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...refusal, at: [...endpointAt, 'input', 'query'] },
        { ...refusal, at: ['guards', 'tenant', 'demands', 'query'] },
      ],
    });
  });
});
