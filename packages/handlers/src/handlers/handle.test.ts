import {
  defineCommand,
  defineEndpoint,
  defineEvent,
  defineGuard,
  defineSubscription,
  notFound,
  openEnumReader,
} from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  admit,
  type CommandHandler,
  type EndpointHandler,
  type EventHandler,
  type Fault,
  fault,
  type GuardHandler,
  type HandlerMap,
  handle,
  type MessageMeta,
  reject,
  success,
  withReader,
} from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
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

function aCommand<const Name extends string>(name: Name) {
  return defineCommand({
    name,
    version: 1,
    description: 'Acts on an order',
    body: z.object({ orderId: z.uuid() }),
  });
}

const chargeCardV1 = aCommand('ChargeCard');
const refundCardV1 = aCommand('RefundCard');

const statusReader = z.object({ orderId: z.uuid(), status: openEnumReader(['pending', 'paid']) });

const chargeCard = withReader(chargeCardV1, statusReader);
const refundCard = withReader(refundCardV1, statusReader);

const orderPaidV1 = defineEvent({
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: z.object({ orderId: z.uuid() }),
});

const notifyOnPaidV1 = defineSubscription({ name: 'notify-on-paid', event: orderPaidV1 });

const notifyOnPaid = withReader(notifyOnPaidV1, statusReader);

const meta = { messageId: 'ChargeCard.v1:o-1', factId: 'o-1', deliveryCount: 1 };

describe('handle', () => {
  test('a Handler returned by handle() is a function that carries its Element', () => {
    const getOrderHandler = handle(getOrder, () => success({ id: ORDER_ID }));

    expect(typeof getOrderHandler).toBe('function');
    expect(getOrderHandler.element).toBe(getOrder);
  });

  test('handle() given something that is no Endpoint, Guard or paired Command or Subscription throws', () => {
    const notAnElement = { ...getOrder };

    const write = () => handle(notAnElement, () => success({ id: ORDER_ID }));

    expect(write).toThrow(
      'handle() takes an Endpoint or a Guard, or a Command or Subscription paired with its Reader by withReader()',
    );
  });

  test("a Message Handler carries the root's own Command or Subscription as its element", () => {
    const chargeCardHandler = handle(chargeCard, () => undefined);
    const notifyOnPaidStub = handle.stub(notifyOnPaid);

    const elements = [chargeCardHandler.element, notifyOnPaidStub.element];

    expect(elements).toEqual([chargeCardV1, notifyOnPaidV1]);
    expect(elements[0]).toBe(chargeCardV1);
    expect(elements[1]).toBe(notifyOnPaidV1);
  });

  test('handle() given a bare Command or Subscription is a type error and throws', () => {
    const writes = [
      // @ts-expect-error a Command is handled only paired with its Reader
      () => handle(chargeCardV1, () => undefined),
      // @ts-expect-error a Subscription is handled only paired with its Reader
      () => handle.stub(notifyOnPaidV1),
    ];

    for (const write of writes) {
      expect(write).toThrow('paired with its Reader by withReader()');
    }
  });

  test('a Handler of one Command is not a Handler of another', () => {
    const chargeCardHandler = handle(chargeCard, () => undefined);

    // @ts-expect-error a Handler is nominal over its Command
    const refundCardHandler: CommandHandler<typeof refundCard> = chargeCardHandler;

    expectTypeOf(chargeCardHandler).toEqualTypeOf<CommandHandler<typeof chargeCard>>();
    expectTypeOf(handle.stub(notifyOnPaid)).toEqualTypeOf<EventHandler<typeof notifyOnPaid>>();
    expect(refundCardHandler.element).toBe(chargeCardV1);
  });

  test("a Message Handler's body is typed by its Reader, Unknown cases included", () => {
    type Body = { orderId: string; status: 'pending' | 'paid' | { unknown: string } };
    const received: Body[] = [];

    const chargeCardHandler = handle(chargeCard, (body) => {
      expectTypeOf(body).toEqualTypeOf<Body>();
      received.push(body);
    });

    expectTypeOf(chargeCardHandler).parameter(0).toEqualTypeOf<Body>();
    expect(received).toEqual([]);
  });

  test('a direct call takes headers as optional and the implementation receives them', () => {
    const notifyOnPaidHandler = handle(notifyOnPaid, (_body, given) => {
      expectTypeOf(given).toEqualTypeOf<MessageMeta>();
    });

    expectTypeOf(notifyOnPaidHandler).toBeCallableWith({ orderId: ORDER_ID, status: 'paid' }, meta);
    expectTypeOf(notifyOnPaidHandler).toBeCallableWith(
      { orderId: ORDER_ID, status: { unknown: 'refunded' } },
      { ...meta, headers: { traceparent: '00-abc-def-01' } },
    );
    expectTypeOf<MessageMeta['headers']>().toEqualTypeOf<Readonly<Record<string, string>>>();
    expect(notifyOnPaidHandler.element).toBe(notifyOnPaidV1);
  });

  test("a Message Handler's direct call answers a Fault or nothing", () => {
    const chargeCardHandler = handle(chargeCard, () => fault({ committed: 'no', retryable: true }));

    const answer = chargeCardHandler({ orderId: ORDER_ID, status: 'paid' }, meta);

    expectTypeOf(answer).toEqualTypeOf<Promise<Fault | undefined>>();
    expect(answer).toBeInstanceOf(Promise);
  });

  test('an implementation returning a value that is no Fault is a type error', () => {
    // @ts-expect-error a Message Handler returns nothing or a Fault
    const write = () => handle(chargeCard, () => success());

    expect(write).not.toThrow();
  });

  test('an implementation returning any value but nothing or a Fault is a type error', () => {
    // @ts-expect-error a Message Handler returns nothing or a Fault, never a value
    const write = () => handle(chargeCard, async () => 42);

    expect(write).not.toThrow();
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
      context: z.object({ callerId: z.string() }),
    });
    const apiKeyHandler = handle(apiKey, () => admit({ callerId: 'c-1' }));

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

describe('withReader', () => {
  test('withReader given something that is no Command or Subscription, or no zod schema, throws', () => {
    const pairs = [
      () => withReader(getOrder as never, statusReader),
      () => withReader({ ...chargeCardV1 }, statusReader),
      () => withReader(chargeCardV1, { _zod: {} } as never),
    ];

    for (const pair of pairs) {
      expect(pair).toThrow('withReader() takes');
    }
  });
});

describe('HandlerMap', () => {
  test('takes Handlers of Commands by name in code and of Subscriptions by name', () => {
    const generated = {
      endpoints: {},
      guards: {},
      commands: { chargeCardV1: handle.stub(chargeCard) },
      subscriptions: { 'notify-on-paid': handle.stub(notifyOnPaid) },
      deprecatedAt: {},
    };

    const map: HandlerMap = generated;

    expectTypeOf(generated).toExtend<HandlerMap>();
    expect(map.subscriptions['notify-on-paid']?.element).toBe(notifyOnPaidV1);
  });

  test('refuses a map whose commands hold the Handler of an Endpoint', () => {
    const generated = {
      endpoints: {},
      guards: {},
      commands: { chargeCardV1: handle.stub(getOrder) },
      subscriptions: {},
      deprecatedAt: {},
    };

    expectTypeOf(generated).not.toExtend<HandlerMap>();
    expect(generated.commands.chargeCardV1.element).toBe(getOrder);
  });

  test('takes the map handlers.generated.ts exports, Handlers by name and the stamps', () => {
    const generated = {
      endpoints: { getOrder: handle.stub(getOrder), findOrder: handle.stub(findOrder) },
      guards: { apiKey: handle.stub(apiKey) },
      commands: {},
      subscriptions: {},
      deprecatedAt: { findOrder: '2026-10-17T09:30:00Z' },
    };

    const map: HandlerMap = generated;

    expectTypeOf(generated).toExtend<HandlerMap>();
    expect(map.guards['apiKey']?.element).toBe(apiKey);
  });

  test('refuses a map whose Handler is no Handler', () => {
    const generated = {
      endpoints: { getOrder: () => undefined },
      guards: {},
      commands: {},
      subscriptions: {},
      deprecatedAt: {},
    };

    expectTypeOf(generated).not.toExtend<HandlerMap>();
    expect(generated.endpoints.getOrder()).toBeUndefined();
  });
});
