import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  defineEndpoint,
  defineRejection,
  type InputOf,
  invalidInput,
  notFound,
  notImplemented,
  type SuccessOf,
} from '../index.ts';

const orderBody = z.object({ id: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });

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

const getOrder = {
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  input: { params: orderParams },
  success: { status: 200, body: orderBody },
} as const;

describe('defineEndpoint', () => {
  test('a declared Endpoint keeps the author’s schemas by identity', () => {
    const endpoint = defineEndpoint(getOrder);

    expect(endpoint.input.params).toBe(orderParams);
    expect(endpoint.success.body).toBe(orderBody);
    expect(endpoint.kind).toBe('endpoint');
    expect(Object.isFrozen(endpoint)).toBe(true);
  });

  test('an Endpoint’s input type is inferred from its params, query, headers and body', () => {
    const updateItem = defineEndpoint({
      name: 'updateItem',
      method: 'PUT',
      path: '/orders/:orderId/items/:itemId',
      visibility: 'internal',
      description: 'Replaces one item',
      input: {
        params: z.object({ orderId: z.uuid(), itemId: z.int() }),
        query: z.object({ dryRun: z.boolean().optional() }),
        headers: z.object({ 'if-match': z.string() }),
        body: z.object({ quantity: z.int() }),
      },
      success: { status: 204 },
    });

    expectTypeOf<InputOf<typeof updateItem>>().toEqualTypeOf<{
      readonly params: { orderId: string; itemId: number };
      readonly query: { dryRun?: boolean | undefined };
      readonly headers: { 'if-match': string };
      readonly body: { quantity: number };
    }>();
  });

  test('an Endpoint’s Success type is its status with its headers and body typed', () => {
    const endpoint = defineEndpoint({
      ...createOrder,
      success: { ...createOrder.success, headers: z.object({ location: z.string() }) },
    });

    expectTypeOf<SuccessOf<typeof endpoint>>().toEqualTypeOf<{
      readonly status: 201;
      readonly headers: { location: string };
      readonly body: { id: string };
    }>();
  });
});

describe('defineEndpoint names', () => {
  test('a name JavaScript calls on its own is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...getOrder,
        // @ts-expect-error then is a name JavaScript calls on its own
        name: 'then',
      });

    expect(declare).not.toThrow();
  });

  test('a name every object already has is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...getOrder,
        // @ts-expect-error toString is a name every object already has
        name: 'toString',
      });

    expect(declare).not.toThrow();
  });

  test('a word code cannot bind a name by is a type error', () => {
    const declareClass = () =>
      defineEndpoint({
        ...getOrder,
        // @ts-expect-error class is an ECMAScript reserved word
        name: 'class',
      });
    const declareHandle = () =>
      defineEndpoint({
        ...getOrder,
        // @ts-expect-error every stub imports handle
        name: 'handle',
      });

    expect(declareClass).not.toThrow();
    expect(declareHandle).not.toThrow();
  });

  test('a name typed as a string skips the rule', () => {
    const name: string = 'then';

    const endpoint = defineEndpoint({ ...getOrder, name });

    expect(endpoint.name).toBe('then');
  });

  test('a name that only contains a reserved name compiles and stays a literal', () => {
    const endpoint = defineEndpoint({ ...getOrder, name: 'thenable' });

    expectTypeOf(endpoint.name).toEqualTypeOf<'thenable'>();
  });
});

describe('defineEndpoint path params', () => {
  test('a path’s :name missing from params is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...getOrder,
        path: '/orders/:orderId/items/:itemId',
        // @ts-expect-error itemId is missing
        input: { params: orderParams },
      });

    expect(declare).not.toThrow();
  });

  test('a param that is not a :name of the path is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...getOrder,
        // @ts-expect-error id is not a :name of the path
        input: { params: z.object({ orderId: z.uuid(), id: z.uuid() }) },
      });

    expect(declare).not.toThrow();
  });

  test('a path with :names needs params', () => {
    const { input: _input, ...withoutInput } = getOrder;

    // @ts-expect-error the path's :names need params
    const declare = () => defineEndpoint(withoutInput);

    expect(declare).not.toThrow();
  });

  test('an Endpoint without path names takes no params', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error the path has no :names
        input: { params: orderParams },
      });

    expect(declare).not.toThrow();
  });

  test('a path typed wider than a literal skips the params rule', () => {
    const path: string = '/orders/:orderId';

    const endpoint = defineEndpoint({ ...getOrder, path });

    expect(endpoint.path).toBe(path);
  });
});

describe('defineEndpoint methods', () => {
  test('HEAD is no method an Endpoint declares: a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error HEAD is no Method
        method: 'HEAD',
      });

    expect(declare).not.toThrow();
  });
});

describe('defineEndpoint bodies', () => {
  test('a body on GET is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error a GET takes no body
        input: { body: z.object({ status: z.string() }) },
      });

    expect(declare).not.toThrow();
  });

  test('a 204 Success with a body is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...createOrder,
        // @ts-expect-error a 204 has no body
        success: { status: 204, body: orderBody },
      });

    expect(declare).not.toThrow();
  });

  test('a Success other than 204 without a body is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...createOrder,
        // @ts-expect-error a 201 needs a body
        success: { status: 201 },
      });

    expect(declare).not.toThrow();
  });
});

describe('defineEndpoint Success statuses', () => {
  test('a Success status of 200 and of 204 type-check', () => {
    const endpoints = [
      defineEndpoint({ ...createOrder, success: { status: 200, body: orderBody } }),
      defineEndpoint({ ...createOrder, success: { status: 204 } }),
    ];

    expect(endpoints.map((endpoint) => endpoint.success.status)).toEqual([200, 204]);
  });

  test('a Success status of 199 is a type error', () => {
    const declare = () =>
      // @ts-expect-error 199 is not a Success status
      defineEndpoint({ ...createOrder, success: { status: 199, body: orderBody } });

    expect(declare).not.toThrow();
  });

  test('a Success status of 205 is a type error', () => {
    const declare = () =>
      // @ts-expect-error 205 is not a Success status
      defineEndpoint({ ...createOrder, success: { status: 205, body: orderBody } });

    expect(declare).not.toThrow();
  });
});

describe('defineEndpoint Rejections', () => {
  test('an Endpoint may list notFound and its own Rejections', () => {
    const orderLocked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });

    const endpoint = defineEndpoint({ ...listOrders, rejections: [notFound, orderLocked] });

    expect(endpoint.rejections).toEqual([notFound, orderLocked]);
  });

  test('an Endpoint listing one Rejection twice is a type error', () => {
    const orderLocked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });

    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error ORDER_LOCKED is listed twice
        rejections: [orderLocked, notFound, orderLocked],
      });

    expect(declare).not.toThrow();
  });

  test('an Endpoint listing two Rejections with one code is a type error', () => {
    const locked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });
    const lockedAgain = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });

    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error ORDER_LOCKED is listed twice
        rejections: [locked, lockedAgain],
      });

    expect(declare).not.toThrow();
  });

  test('an Endpoint listing notFound twice is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error notFound is listed twice
        rejections: [notFound, notFound],
      });

    expect(declare).not.toThrow();
  });

  test('an Endpoint listing two different Rejections is not an error', () => {
    const locked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });
    const gone = defineRejection({ code: 'ORDER_GONE', status: 410, message: 'Gone' });

    const endpoint = defineEndpoint({ ...listOrders, rejections: [locked, gone, notFound] });

    expect(endpoint.rejections).toEqual([locked, gone, notFound]);
  });

  test('an Endpoint listing invalidInput is a type error', () => {
    // @ts-expect-error invalidInput is always added
    const declare = () => defineEndpoint({ ...listOrders, rejections: [invalidInput] });

    expect(declare).not.toThrow();
  });

  test('an Endpoint listing notImplemented is a type error', () => {
    // @ts-expect-error notImplemented is always added
    const declare = () => defineEndpoint({ ...listOrders, rejections: [notImplemented] });

    expect(declare).not.toThrow();
  });
});

describe('defineEndpoint header names', () => {
  test('an upper-case Input header name is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error header names are lower-case
        input: { headers: z.object({ 'X-Tenant': z.string() }) },
      });

    expect(declare).not.toThrow();
  });

  test('an upper-case Success header name is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...createOrder,
        success: {
          ...createOrder.success,
          // @ts-expect-error header names are lower-case
          headers: z.object({ 'Content-Location': z.string() }),
        },
      });

    expect(declare).not.toThrow();
  });

  test('a header object keyed wider than literals skips the header-name rule', () => {
    const shape: Record<string, z.ZodString> = { 'x-tenant': z.string() };
    const headers = z.object(shape);

    const endpoint = defineEndpoint({ ...listOrders, input: { headers } });

    expect(endpoint.input.headers).toBe(headers);
  });
});

describe('defineEndpoint fields', () => {
  test('an undeclared field is a type error', () => {
    // @ts-expect-error group is not a field of an Endpoint
    const declare = () => defineEndpoint({ ...listOrders, group: 'orders' });

    expect(declare).not.toThrow();
  });
});

describe('a declared Endpoint’s containers', () => {
  test('an Endpoint freezes its containers and keeps its schemas', () => {
    const input = { params: orderParams };
    const rejections = [notFound];

    const endpoint = defineEndpoint({ ...getOrder, input, rejections });
    Reflect.set(input, 'params', z.object({}));
    rejections.pop();

    expect(endpoint.input.params).toBe(orderParams);
    expect(endpoint.rejections).toEqual([notFound]);
    expect(Object.isFrozen(endpoint.input)).toBe(true);
    expect(Object.isFrozen(endpoint.success)).toBe(true);
    expect(Object.isFrozen(endpoint.rejections)).toBe(true);
    expect(Object.isFrozen(orderParams)).toBe(false);
  });
});

describe('defineEndpoint nested fields', () => {
  test('an undeclared field in input is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        input: {
          headers: z.object({ 'x-tenant': z.string() }),
          // @ts-expect-error querry is not a part of input
          querry: z.object({ page: z.int() }),
        },
      });

    expect(declare).not.toThrow();
  });

  test('an undeclared field in success is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        // @ts-expect-error bdy is not a part of a Success
        success: { status: 200, body: orderBody, bdy: orderBody },
      });

    expect(declare).not.toThrow();
  });
});

describe('defineEndpoint errors', () => {
  test('an undeclared input key is the only error its declaration reports', () => {
    const declare = () =>
      defineEndpoint({
        name: 'listOrders',
        method: 'GET',
        path: '/orders',
        visibility: 'public',
        description: 'Every order',
        input: {
          // @ts-expect-error querry is not a part of input
          querry: z.object({ page: z.int() }),
        },
        success: { status: 200, body: z.array(orderBody) },
      });

    expect(declare).not.toThrow();
  });

  test('a Success status outside the allowed ones is the only error its declaration reports', () => {
    const declare = () =>
      defineEndpoint({
        ...listOrders,
        success: {
          // @ts-expect-error 299 is not a Success status
          status: 299,
          body: z.array(orderBody),
        },
      });

    expect(declare).not.toThrow();
  });
});

describe('a declared Endpoint’s Standard Rejections', () => {
  test('an Endpoint keeps notFound itself', () => {
    const endpoint = defineEndpoint({ ...listOrders, rejections: [notFound] });

    expect(endpoint.rejections[0]).toBe(notFound);
  });
});
