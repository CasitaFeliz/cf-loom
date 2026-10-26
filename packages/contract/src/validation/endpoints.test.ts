import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  type Lifecycle,
  type Method,
  type SuccessStatus,
  type Visibility,
} from '../index.ts';
import { type Root, validateRoot } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
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
  return validateInPackage(defineService({ name: 'orders-service', groups: [orders] }));
}

/** An Endpoint declared through a cast, as a caller the types do not reach can write one. */
function castEndpoint(declaration: object): Endpoint {
  return defineEndpoint(declaration as never);
}

function failedAt(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

describe('validateRoot: an Endpoint’s method, Visibility and lifecycle', () => {
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
        'endpoints.TRACE /orders (listOrders) method',
        'method',
        'A method is GET, POST, PUT, PATCH, DELETE or OPTIONS: "TRACE"',
      ),
    );
  });

  test('a HEAD Endpoint reached through a cast fails the method rule', () => {
    const method = 'HEAD' as Method;

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, method }));

    expect(validated).toEqual(
      failedAt(
        'endpoints.HEAD /orders (listOrders) method',
        'method',
        'A method is GET, POST, PUT, PATCH, DELETE or OPTIONS: "HEAD"',
      ),
    );
  });

  test('a Visibility outside public, internal and private fails', () => {
    const visibility = 'protected' as Visibility;

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, visibility }));

    expect(validated).toEqual(
      failedAt(
        'endpoints.GET /orders (listOrders) visibility',
        'visibility',
        'A Visibility is public, internal or private: "protected"',
      ),
    );
  });

  test('a lifecycle outside active, deprecated and retired fails', () => {
    const lifecycle = 'sunset' as Lifecycle;

    const validated = validateEndpoint(castEndpoint({ ...listOrders, lifecycle }));

    expect(validated).toEqual(
      failedAt(
        'endpoints.GET /orders (listOrders) lifecycle',
        'lifecycle',
        'A lifecycle is active, deprecated or retired: "sunset"',
      ),
    );
  });
});

describe('validateRoot: the instant an Endpoint is Deprecated as of', () => {
  const instant =
    "A Deprecated Endpoint's deprecatedAt is a UTC instant to the second, such as 2026-11-01T00:00:00Z";

  test('a Deprecated Endpoint with its instant validates', () => {
    const deprecated = defineEndpoint({
      ...listOrders,
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
    });

    expect(validateEndpoint(deprecated).kind).toBe('valid');
  });

  test('an instant that lies in the future validates', () => {
    const deprecated = defineEndpoint({
      ...listOrders,
      lifecycle: 'deprecated',
      deprecatedAt: '2999-01-01T00:00:00Z',
    });

    expect(validateEndpoint(deprecated).kind).toBe('valid');
  });

  test('a Deprecated Endpoint without deprecatedAt fails', () => {
    const validated = validateEndpoint(castEndpoint({ ...listOrders, lifecycle: 'deprecated' }));

    expect(validated).toEqual(
      failedAt('endpoints.GET /orders (listOrders) deprecatedAt', 'deprecated-at', instant),
    );
  });

  test.each([
    '2026-11-01',
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00+01:00',
    '2026-02-30T00:00:00Z',
    'tomorrow',
    '',
  ])('a deprecatedAt that is no UTC instant to the second, %j, fails', (deprecatedAt) => {
    const deprecated = { ...listOrders, lifecycle: 'deprecated', deprecatedAt };

    const validated = validateEndpoint(castEndpoint(deprecated));

    expect(validated).toEqual(
      failedAt('endpoints.GET /orders (listOrders) deprecatedAt', 'deprecated-at', instant),
    );
  });

  test('a deprecatedAt beside a lifecycle that is none fails the lifecycle rule alone', () => {
    const lifecycle = 'sunset' as Lifecycle;
    const declared = { ...listOrders, lifecycle, deprecatedAt: '2026-11-01T00:00:00Z' };

    const validated = validateEndpoint(castEndpoint(declared));

    expect(validated).toEqual(
      failedAt(
        'endpoints.GET /orders (listOrders) lifecycle',
        'lifecycle',
        'A lifecycle is active, deprecated or retired: "sunset"',
      ),
    );
  });

  test('a deprecatedAt that is no text fails the text rule alone', () => {
    const deprecated = { ...listOrders, lifecycle: 'deprecated', deprecatedAt: 1788220800 };

    const validated = validateEndpoint(castEndpoint(deprecated));

    expect(validated).toEqual(
      failedAt(
        'endpoints.GET /orders (listOrders) deprecatedAt',
        'not-a-string',
        'deprecatedAt is a string',
      ),
    );
  });

  test.each([
    ['an Active Endpoint', { lifecycle: 'active' }],
    ['an Endpoint with no lifecycle', {}],
    ['a Retired Endpoint', { lifecycle: 'retired' }],
  ])('deprecatedAt on %s fails', (_name, lifecycle) => {
    const declared = { ...listOrders, ...lifecycle, deprecatedAt: '2026-11-01T00:00:00Z' };

    const validated = validateEndpoint(castEndpoint(declared));

    expect(validated).toEqual(
      failedAt(
        'endpoints.GET /orders (listOrders) deprecatedAt',
        'deprecated-at',
        'Only a Deprecated Endpoint declares deprecatedAt',
      ),
    );
  });
});

describe('validateRoot: a Success’s status and body', () => {
  test('a Success status outside 200 to 204 fails', () => {
    const status = 205 as SuccessStatus;

    const validated = validateEndpoint(
      defineEndpoint({ ...createOrder, success: { status, body: orderBody } }),
    );

    expect(validated).toEqual(
      failedAt(
        'endpoints.POST /orders (createOrder) success.status',
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
      failedAt(
        'endpoints.POST /orders (createOrder) success.body',
        'success-body',
        'A 204 Success has no body',
      ),
    );
  });

  test('a Success other than 204 without a body fails', () => {
    const status = 201 as SuccessStatus;

    const validated = validateEndpoint(defineEndpoint({ ...createOrder, success: { status } }));

    expect(validated).toEqual(
      failedAt(
        'endpoints.POST /orders (createOrder) success.body',
        'success-body',
        'A 201 Success has a body',
      ),
    );
  });
});

describe('validateRoot: an Input body', () => {
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
      failedAt(
        'endpoints.GET /orders (listOrders) input.body',
        'input-body',
        'A GET Endpoint takes no body',
      ),
    );
  });
});

describe('validateRoot: where Endpoints sit', () => {
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
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    const nonText =
      'A query param travels as text: a string, number, boolean, literal or enum, or a list of those: page';
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'endpoints.GET /orders/all (listOrders) input.query.page',
          rule: 'not-text',
          message: nonText,
        },
        {
          kind: 'declaration',
          location: 'endpoints.GET /orders/{} (listOrders) input.query.page',
          rule: 'not-text',
          message: nonText,
        },
      ],
    });
  });
});
