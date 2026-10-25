import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import { defineContract, defineEndpoint, defineGroup, type Endpoint } from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  return validateContract(root, aRootPackage(root, { originOf }));
}

const listOrders = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

/** The result of validating one Endpoint, written with a cast where the types refuse it. */
function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(
    defineContract({ name: 'orders-service', groups: [orders] }),
    () => undefined,
  );
}

/** A path failure of the Endpoint of that identity: a path that is not canonical still has one. */
function failedPath(identity: string, message: string, rule = 'canonical-path') {
  return failedAt(['groups', 'orders', 'endpoints', identity, 'path'], rule, message);
}

function failedAt(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: canonical paths', () => {
  test('a canonical path with literal and param segments validates', () => {
    const getItem = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId/items/:itemId',
      input: { params: z.object({ orderId: z.uuid(), itemId: z.int() }) },
    });

    expect(validateEndpoint(getItem).kind).toBe('valid');
  });

  test('the root path validates', () => {
    expect(validateEndpoint(defineEndpoint({ ...listOrders, path: '/' })).kind).toBe('valid');
  });

  test('a path typed wider than a literal is checked like a literal one', () => {
    const path: string = '/orders/:orderId';

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path }));

    expect(validated).toEqual(
      failedAt(
        ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'input', 'params'],
        'exact-params',
        "params declares exactly the path's :names: orderId",
      ),
    );
  });

  test('a path without a leading slash fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: 'orders' }));

    expect(validated).toEqual(failedPath('GET /orders', 'A path starts with /: orders'));
  });

  test('a path with a trailing slash fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders/' }));

    expect(validated).toEqual(failedPath('GET /orders', 'A path has no trailing slash: /orders/'));
  });

  test('a path with an empty segment fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders//latest' }));

    expect(validated).toEqual(
      failedPath('GET /orders//latest', 'A path has no empty segment: /orders//latest'),
    );
  });

  test('a path with an upper-case letter fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/Orders' }));

    expect(validated).toEqual(
      failedPath('GET /Orders', 'A path segment is lower-case letters, digits and dashes: Orders'),
    );
  });

  test('a path with a dot, percent-encoding or a query fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders.json' }));

    expect(validated).toEqual(
      failedPath(
        'GET /orders.json',
        'A path segment is lower-case letters, digits and dashes: orders.json',
      ),
    );
  });

  test('a param that is not a whole segment fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders/id-:id' }));

    expect(validated).toEqual(
      failedPath(
        'GET /orders/id-:id',
        'A path segment is lower-case letters, digits and dashes: id-:id',
      ),
    );
  });

  test('a param with a dot fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/files/:file.json',
        input: { params: z.object({ 'file.json': z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath('GET /files/{}', 'A path param is written :camelCase: :file.json'),
    );
  });

  test('an empty param fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/orders/:',
        input: { params: z.object({ '': z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath('GET /orders/{}', 'A path param is written :camelCase: :'),
    );
  });

  test('a param written in PascalCase fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/orders/:OrderId',
        // biome-ignore lint/style/useNamingConvention: the param under test is PascalCase
        input: { params: z.object({ OrderId: z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath('GET /orders/{}', 'A path param is written :camelCase: :OrderId'),
    );
  });

  test('a path with the same param twice fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/orders/:id/items/:id',
        input: { params: z.object({ id: z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath(
        'GET /orders/{}/items/{}',
        'A path param appears once: :id',
        'duplicate-path-param',
      ),
    );
  });

  test('every way a path breaks the grammar is named, and params are not judged against it', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: 'Orders/:id/',
        input: { params: z.object({ id: z.string() }) },
      }),
    );

    const pathAt = ['groups', 'orders', 'endpoints', 'GET /Orders/{}', 'path'];
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: pathAt,
          rule: 'canonical-path',
          message: 'A path starts with /: Orders/:id/',
        },
        {
          kind: 'declaration',
          at: pathAt,
          rule: 'canonical-path',
          message: 'A path has no trailing slash: Orders/:id/',
        },
        {
          kind: 'declaration',
          at: pathAt,
          rule: 'canonical-path',
          message: 'A path segment is lower-case letters, digits and dashes: Orders',
        },
      ],
    });
  });
});

describe('validateContract: params against the path', () => {
  const paramsAt = ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'input', 'params'];

  test('params with exactly the path’s :names validate', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid() }) },
    });

    expect(validateEndpoint(getOrder).kind).toBe('valid');
  });

  test('a path’s :name missing from params fails', () => {
    const params = z.object({ orderId: z.uuid() }) as z.ZodObject<{
      orderId: z.ZodUUID;
      itemId: z.ZodInt;
    }>;
    const getItem = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId/items/:itemId',
      input: { params },
    });

    expect(validateEndpoint(getItem)).toEqual(
      failedAt(
        ['groups', 'orders', 'endpoints', 'GET /orders/{}/items/{}', 'input', 'params'],
        'exact-params',
        "params declares exactly the path's :names: orderId, itemId",
      ),
    );
  });

  test('a param that is not a :name of the path fails', () => {
    const params = z.object({ orderId: z.uuid(), id: z.uuid() }) as z.ZodObject<{
      orderId: z.ZodUUID;
    }>;
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId', input: { params } });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'exact-params', "params declares exactly the path's :names: orderId"),
    );
  });

  test('a path with :names and no params fails', () => {
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId' as string });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'exact-params', "params declares exactly the path's :names: orderId"),
    );
  });

  test('params on a path without :names fail', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders' as string,
      input: { params: z.object({ orderId: z.uuid() }) },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'input', 'params'],
        'exact-params',
        'A path without :names takes no params',
      ),
    );
  });

  test('an optional path param fails', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid().optional() }) },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(
        [...paramsAt, 'fields', 'orderId'],
        'optional-path-param',
        'A path param is never optional: orderId',
      ),
    );
  });

  test('params that are not an object fail once, as a part that is no object', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: z.string() as unknown as z.ZodObject<{ orderId: z.ZodUUID }> },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'not-an-object-schema', 'params is an object of its fields'),
    );
  });

  test('an input that is a list fails once, as no object', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: [] as unknown as { params: z.ZodObject<{ orderId: z.ZodUUID }> },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(
        ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'input'],
        'not-an-object',
        'input is an object',
      ),
    );
  });

  test('params that are no schema fail once, as a slot with no schema', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: 'orderId' as unknown as z.ZodObject<{ orderId: z.ZodUUID }> },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'not-a-schema', 'params is not a zod schema'),
    );
  });
});
