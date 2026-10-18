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
} from './index.ts';

const orderBody = z.object({ id: z.uuid() });

describe('defineEndpoint', () => {
  test('a declared Endpoint keeps the author’s schemas by identity', () => {
    const params = z.object({ orderId: z.uuid() });

    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders/:orderId',
      visibility: 'public',
      description: 'One order by id',
      input: { params },
      success: { status: 200, body: orderBody },
    });

    expect(getOrder.input.params).toBe(params);
    expect(getOrder.success.body).toBe(orderBody);
    expect(getOrder.kind).toBe('endpoint');
    expect(Object.isFrozen(getOrder)).toBe(true);
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
    expectTypeOf<SuccessOf<typeof updateItem>>().toEqualTypeOf<{ readonly status: 204 }>();
  });

  test('a path’s :names must be declared exactly in params', () => {
    const declare = () => [
      defineEndpoint({
        name: 'getItem',
        method: 'GET',
        path: '/orders/:orderId/items/:itemId',
        visibility: 'public',
        description: 'One item',
        input: {
          // @ts-expect-error itemId is missing
          params: z.object({ orderId: z.uuid() }),
        },
        success: { status: 200, body: orderBody },
      }),
      defineEndpoint({
        name: 'getOrder',
        method: 'GET',
        path: '/orders/:orderId',
        visibility: 'public',
        description: 'One order',
        input: {
          // @ts-expect-error id is not a :name of the path
          params: z.object({ orderId: z.uuid(), id: z.uuid() }),
        },
        success: { status: 200, body: orderBody },
      }),
      // @ts-expect-error the path's :names need params
      defineEndpoint({
        name: 'getOrder',
        method: 'GET',
        path: '/orders/:orderId',
        visibility: 'public',
        description: 'One order',
        success: { status: 200, body: orderBody },
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('an Endpoint without path names takes no params', () => {
    const declare = () =>
      defineEndpoint({
        name: 'listOrders',
        method: 'GET',
        path: '/orders',
        visibility: 'public',
        description: 'Every order',
        input: {
          // @ts-expect-error the path has no :names
          params: z.object({ orderId: z.uuid() }),
        },
        success: { status: 200, body: z.array(orderBody) },
      });

    expect(declare).not.toThrow();
  });

  test('a body on GET or HEAD is a type error', () => {
    const declare = () => [
      defineEndpoint({
        name: 'searchOrders',
        method: 'GET',
        path: '/orders',
        visibility: 'public',
        description: 'Orders matching a filter',
        // @ts-expect-error a GET takes no body
        input: { body: z.object({ status: z.string() }) },
        success: { status: 200, body: z.array(orderBody) },
      }),
      defineEndpoint({
        name: 'checkOrders',
        method: 'HEAD',
        path: '/orders',
        visibility: 'public',
        description: 'Whether orders exist',
        // @ts-expect-error a HEAD takes no body
        input: { body: z.object({ status: z.string() }) },
        success: { status: 204 },
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('a 204 Success takes no body, and any other Success requires one', () => {
    const declare = () => [
      defineEndpoint({
        name: 'deleteOrder',
        method: 'DELETE',
        path: '/orders',
        visibility: 'public',
        description: 'Deletes every order',
        // @ts-expect-error a 204 has no body
        success: { status: 204, body: orderBody },
      }),
      defineEndpoint({
        name: 'createOrder',
        method: 'POST',
        path: '/orders',
        visibility: 'public',
        description: 'Creates an order',
        // @ts-expect-error a 201 needs a body
        success: { status: 201 },
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('a Success status outside 200–204 is a type error', () => {
    const declare = () => [
      defineEndpoint({
        name: 'resetOrders',
        method: 'POST',
        path: '/orders/reset',
        visibility: 'private',
        description: 'Resets the view',
        // @ts-expect-error 205 is not a Success status
        success: { status: 205, body: orderBody },
      }),
      defineEndpoint({
        name: 'createOrder',
        method: 'POST',
        path: '/orders',
        visibility: 'public',
        description: 'Creates an order',
        // @ts-expect-error 302 is not a Success status
        success: { status: 302, body: orderBody },
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('an Endpoint may list notFound but not invalidInput or notImplemented', () => {
    const orderLocked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });
    const endpoint = {
      name: 'getOrder',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'The latest order',
      success: { status: 200, body: orderBody },
    } as const;

    const declare = () => [
      defineEndpoint({ ...endpoint, rejections: [notFound, orderLocked] }),
      // @ts-expect-error invalidInput is always added
      defineEndpoint({ ...endpoint, rejections: [invalidInput] }),
      // @ts-expect-error notImplemented is always added
      defineEndpoint({ ...endpoint, rejections: [notImplemented] }),
    ];

    expect(declare).not.toThrow();
  });

  test('an upper-case header name is a type error', () => {
    const declare = () => [
      defineEndpoint({
        name: 'listOrders',
        method: 'GET',
        path: '/orders',
        visibility: 'public',
        description: 'Every order',
        input: {
          // @ts-expect-error header names are lower-case
          headers: z.object({ 'X-Tenant': z.string() }),
        },
        success: { status: 200, body: z.array(orderBody) },
      }),
      defineEndpoint({
        name: 'createOrder',
        method: 'POST',
        path: '/orders',
        visibility: 'public',
        description: 'Creates an order',
        success: {
          status: 201,
          // @ts-expect-error header names are lower-case
          headers: z.object({ 'Content-Location': z.string() }),
          body: orderBody,
        },
      }),
    ];

    expect(declare).not.toThrow();
  });
});

describe('defineEndpoint fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      defineEndpoint({
        name: 'listOrders',
        method: 'GET',
        path: '/orders',
        visibility: 'public',
        description: 'Every order',
        success: { status: 200, body: orderBody },
        // @ts-expect-error group is not a field of an Endpoint
        group: 'orders',
      });

    expect(declare).not.toThrow();
  });
});

describe('a declared Endpoint’s containers', () => {
  test('an Endpoint freezes its containers and keeps its schemas', () => {
    const params = z.object({ orderId: z.uuid() });
    const input = { params };
    const success = { status: 200, body: orderBody } as const;
    const rejections = [notFound];

    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders/:orderId',
      visibility: 'public',
      description: 'One order by id',
      input,
      success,
      rejections,
    });
    Reflect.set(input, 'params', z.object({}));
    rejections.pop();

    expect(getOrder.input.params).toBe(params);
    expect(getOrder.rejections).toEqual([notFound]);
    expect(Object.isFrozen(getOrder.input)).toBe(true);
    expect(Object.isFrozen(getOrder.success)).toBe(true);
    expect(Object.isFrozen(getOrder.rejections)).toBe(true);
    expect(Object.isFrozen(params)).toBe(false);
  });
});
