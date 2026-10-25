import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  type Lifecycle,
  type Method,
  type SuccessStatus,
  type Visibility,
} from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  return validateContract(root, aRootPackage(root, { originOf }));
}

const orderBody = z.object({ id: z.uuid() });

const listOrders = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(orderBody) },
} as const;

const createOrder = {
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Creates an order',
  success: { status: 201, body: orderBody },
} as const;

/** The result of validating one Endpoint, written with a cast where the types refuse it. */
function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(
    defineContract({ name: 'orders-service', groups: [orders] }),
    () => undefined,
  );
}

function failedAt(at: readonly string[], rule: string, message: string) {
  return {
    kind: 'invalid',
    failures: [
      { kind: 'declaration', at: ['groups', 'orders', 'endpoints', ...at], rule, message },
    ],
  };
}

describe('validateContract: an Endpoint’s method, Visibility and lifecycle', () => {
  test('every declared method validates', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
    const endpoints = methods.map((method) => defineEndpoint({ ...createOrder, method }));

    expect(endpoints.map((endpoint) => validateEndpoint(endpoint).kind)).toEqual(
      methods.map(() => 'valid'),
    );
  });

  test('a method typed wider than the declared ones is checked like a literal one', () => {
    const method = 'TRACE' as Method;

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, method }));

    expect(validated).toEqual(
      failedAt(
        ['TRACE /orders', 'method'],
        'method',
        'A method is GET, POST, PUT, PATCH, DELETE or OPTIONS: TRACE',
      ),
    );
  });

  test('a HEAD Endpoint reached through a cast fails the method rule', () => {
    const method = 'HEAD' as Method;

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, method }));

    expect(validated).toEqual(
      failedAt(
        ['HEAD /orders', 'method'],
        'method',
        'A method is GET, POST, PUT, PATCH, DELETE or OPTIONS: HEAD',
      ),
    );
  });

  test('a Visibility outside public, internal and private fails', () => {
    const visibility = 'protected' as Visibility;

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, visibility }));

    expect(validated).toEqual(
      failedAt(
        ['GET /orders', 'visibility'],
        'visibility',
        'A Visibility is public, internal or private: protected',
      ),
    );
  });

  test('a Deprecated Endpoint validates', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, lifecycle: 'deprecated' }));

    expect(validated.kind).toBe('valid');
  });

  test('a lifecycle outside active, deprecated and retired fails', () => {
    const lifecycle = 'sunset' as Lifecycle;

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, lifecycle }));

    expect(validated).toEqual(
      failedAt(
        ['GET /orders', 'lifecycle'],
        'lifecycle',
        'A lifecycle is active, deprecated or retired: sunset',
      ),
    );
  });
});

describe('validateContract: a Success’s status and body', () => {
  test('a Success status outside 200 to 204 fails', () => {
    const status = 205 as SuccessStatus;

    const validated = validateEndpoint(
      defineEndpoint({ ...createOrder, success: { status, body: orderBody } }),
    );

    expect(validated).toEqual(
      failedAt(
        ['POST /orders', 'success', 'status'],
        'success-status',
        'A Success status is 200, 201, 202, 203 or 204: 205',
      ),
    );
  });

  test('a 204 Success without a body validates', () => {
    expect(
      validateEndpoint(defineEndpoint({ ...createOrder, success: { status: 204 } })).kind,
    ).toBe('valid');
  });

  test('a 204 Success with a body fails', () => {
    const status = 204 as SuccessStatus;

    const validated = validateEndpoint(
      defineEndpoint({ ...createOrder, success: { status, body: orderBody } }),
    );

    expect(validated).toEqual(
      failedAt(['POST /orders', 'success', 'body'], 'success-body', 'A 204 Success has no body'),
    );
  });

  test('a Success other than 204 without a body fails', () => {
    const status = 201 as SuccessStatus;

    const validated = validateEndpoint(defineEndpoint({ ...createOrder, success: { status } }));

    expect(validated).toEqual(
      failedAt(['POST /orders', 'success', 'body'], 'success-body', 'A 201 Success has a body'),
    );
  });
});

describe('validateContract: an Input body', () => {
  test('a body on POST validates', () => {
    const validated = validateEndpoint(
      defineEndpoint({ ...createOrder, input: { body: z.object({ total: z.int() }) } }),
    );

    expect(validated.kind).toBe('valid');
  });

  test('a body on GET fails', () => {
    const method = 'GET' as Method;

    const validated = validateEndpoint(
      defineEndpoint({ ...listOrders, method, input: { body: z.object({ total: z.int() }) } }),
    );

    expect(validated).toEqual(
      failedAt(['GET /orders', 'input', 'body'], 'input-body', 'A GET Endpoint takes no body'),
    );
  });
});

describe('validateContract: where Endpoints sit', () => {
  test('a Retired and an Active Endpoint of one name sit at their own identities', () => {
    const retired = defineEndpoint({
      ...listOrders,
      path: '/orders/all',
      lifecycle: 'retired',
      input: { query: z.object({ page: z.object({ size: z.int() }) }) },
    });
    const active = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: {
        params: z.object({ orderId: z.uuid() }),
        query: z.object({ page: z.array(z.object({ size: z.int() })) }),
      },
    });
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [retired, active],
    });

    const validated = validateInPackage(
      defineContract({ name: 'orders-service', groups: [orders] }),
      () => undefined,
    );

    const nonText =
      'A query param travels as text: a string, number, boolean, literal or enum, or a list of those: page';
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: [
            'groups',
            'orders',
            'endpoints',
            'GET /orders/all',
            'input',
            'query',
            'fields',
            'page',
          ],
          rule: 'not-text',
          message: nonText,
        },
        {
          kind: 'declaration',
          at: [
            'groups',
            'orders',
            'endpoints',
            'GET /orders/{}',
            'input',
            'query',
            'fields',
            'page',
          ],
          rule: 'not-text',
          message: nonText,
        },
      ],
    });
  });
});
