import { defineEndpoint, defineGuard, notFound } from '@casitafeliz/loom-contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  admit,
  type EndpointHandler,
  type GuardHandler,
  handle,
  reject,
  success,
} from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
});

function anEndpoint<const Name extends string>(name: Name) {
  return defineEndpoint({
    name,
    method: 'GET',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'One order by id',
    input: { params: z.object({ orderId: z.uuid() }) },
    success: { status: 200, body: z.object({ id: z.uuid() }) },
    rejections: [notFound],
  });
}

const getOrder = anEndpoint('getOrder');
const findOrder = anEndpoint('findOrder');

describe('handle', () => {
  test('a Handler returned by handle() is a function that carries its Element', () => {
    const getOrderHandler = handle(getOrder, () => success({ id: ORDER_ID }));

    expect(typeof getOrderHandler).toBe('function');
    expect(getOrderHandler.element).toBe(getOrder);
  });

  test('handle() given something that is no Endpoint or Guard throws', () => {
    const notAnElement = { ...getOrder };

    const write = () => handle(notAnElement, () => success({ id: ORDER_ID }));

    expect(write).toThrow('handle() takes an Endpoint or a Guard');
  });

  test('a stub is the Handler of the Endpoint or Guard it was written for', () => {
    const endpointStub = handle.stub(getOrder);
    const guardStub = handle.stub(apiKey);

    expectTypeOf(endpointStub).toEqualTypeOf<EndpointHandler<typeof getOrder>>();
    expectTypeOf(guardStub).toEqualTypeOf<GuardHandler<typeof apiKey>>();
    expect(guardStub.element).toBe(apiKey);
  });

  test('a Handler of one Endpoint is not a Handler of another', () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));

    // @ts-expect-error a Handler is nominal over its Element
    const findOrderHandler: EndpointHandler<typeof findOrder> = getOrderHandler;

    expect(findOrderHandler.element).toBe(getOrder);
  });

  test('a Handler of one Guard is not a Handler of another', () => {
    const tenantKey = defineGuard({
      name: 'tenantKey',
      description: 'An API key per tenant',
      demands: { headers: z.object({ 'x-api-key': z.string() }) },
      context: z.object({ clientId: z.string() }),
    });
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 'c-1' }));

    // @ts-expect-error a Handler is nominal over its Guard
    const tenantKeyHandler: GuardHandler<typeof tenantKey> = apiKeyHandler;

    expect(tenantKeyHandler.element).toBe(apiKey);
  });

  test('an implementation that returns no Outcome answers the Fault, a TypeError as cause', async () => {
    const getOrderHandler = handle(getOrder, () => admit() as never);

    const outcome = await getOrderHandler({ params: { orderId: ORDER_ID } }, {});

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'unknown',
      retryable: false,
      message: 'Internal error',
      cause: new TypeError("getOrder's Handler returned no Outcome but the kind admitted"),
    });
  });

  test('a GuardHandler that returns nothing answers the Fault, a TypeError as cause', async () => {
    const apiKeyHandler = handle(apiKey, () => undefined as never);

    const admission = await apiKeyHandler({ headers: { 'x-api-key': 'k' } }, {});

    expect(admission).toMatchObject({
      kind: 'fault',
      cause: new TypeError("apiKey's Handler returned no Outcome but undefined"),
    });
  });
});
