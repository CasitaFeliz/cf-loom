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
  type EndpointImplementation,
  type EventHandler,
  type Fault,
  fault,
  type GuardHandler,
  type HandlerMap,
  handle,
  type MessageMeta,
  type ResourcesNotAnnotated,
  type ResourcesOf,
  readersOf,
  reject,
  success,
  type WithResources,
} from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The Caller holds every listed permission',
  guards: [apiKey],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
});

const orderEndpoint = {
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid() }) },
  rejections: [notFound],
} as const;

const getOrder = defineEndpoint({ ...orderEndpoint, name: 'getOrder' });
const findOrder = defineEndpoint({ ...orderEndpoint, name: 'findOrder' });

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

const orderPaidV1 = defineEvent({
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: z.object({ orderId: z.uuid() }),
});

const notifyOnPaidV1 = defineSubscription({
  name: 'notifyOnPaid',
  description: 'Notify on paid',
  event: orderPaidV1,
});

const readers = readersOf({
  commands: {
    chargeCardV1: { element: chargeCardV1, reader: statusReader },
    refundCardV1: { element: refundCardV1, reader: statusReader },
  },
  subscriptions: { notifyOnPaid: { element: notifyOnPaidV1, reader: statusReader } },
});

const chargeCard = readers.commands.chargeCardV1;
const refundCard = readers.commands.refundCardV1;
const notifyOnPaid = readers.subscriptions.notifyOnPaid;

const meta = { messageId: 'command.ChargeCard.v1:o-1', factId: 'o-1', deliveryCount: 1 };

const handleRefusal =
  'handle() takes an Endpoint or a Guard, or a Command or Subscription paired with its Reader, as the readers file exports it: readers.commands.<name> or readers.subscriptions.<name>';

describe('handle', () => {
  test('a Handler returned by handle() is a function that carries its Element', () => {
    const getOrderHandler = handle(getOrder, () => success({ id: ORDER_ID }));

    expect(typeof getOrderHandler).toBe('function');
    expect(getOrderHandler.element).toBe(getOrder);
  });

  test('handle() given something that is no Endpoint, Guard or paired Command or Subscription throws', () => {
    const notAnElement = { ...getOrder };

    const write = () => handle(notAnElement, () => success({ id: ORDER_ID }));

    expect(write).toThrow(handleRefusal);
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
      // @ts-expect-error a Command is handled only as the readers file pairs it
      () => handle(chargeCardV1, () => undefined),
      // @ts-expect-error a Subscription is handled only as the readers file pairs it
      () => handle.stub(notifyOnPaidV1),
    ];

    for (const write of writes) {
      expect(write).toThrow(handleRefusal);
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

  test('a direct call without lastAttempt gives the Handler lastAttempt false', async () => {
    const given: MessageMeta[] = [];
    const notifyOnPaidHandler = handle(notifyOnPaid, (_body, received) => {
      given.push(received);
    });

    await notifyOnPaidHandler({ orderId: ORDER_ID, status: 'paid' }, meta);
    await notifyOnPaidHandler(
      { orderId: ORDER_ID, status: 'paid' },
      { ...meta, lastAttempt: true },
    );

    expect(given.map(({ lastAttempt }) => lastAttempt)).toEqual([false, true]);
  });

  test('a direct call without a signal gives the Handler a signal that is not aborted', async () => {
    const given: MessageMeta[] = [];
    const notifyOnPaidHandler = handle(notifyOnPaid, (_body, received) => {
      given.push(received);
    });

    await notifyOnPaidHandler({ orderId: ORDER_ID, status: 'paid' }, meta);

    expect(given[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(given[0]?.signal.aborted).toBe(false);
  });

  test("a direct call's signal reaches the Handler as given", async () => {
    const given: MessageMeta[] = [];
    const notifyOnPaidHandler = handle(notifyOnPaid, (_body, received) => {
      given.push(received);
    });
    const signal = AbortSignal.abort(new Error('shutting down'));

    await notifyOnPaidHandler({ orderId: ORDER_ID, status: 'paid' }, { ...meta, signal });

    expect(given[0]?.signal).toBe(signal);
  });

  test("MessageMeta's signal is an AbortSignal, and a direct call takes one or leaves it out", () => {
    const notifyOnPaidHandler = handle(notifyOnPaid, () => undefined);

    expectTypeOf<MessageMeta['signal']>().toEqualTypeOf<AbortSignal>();
    expectTypeOf(notifyOnPaidHandler).toBeCallableWith({ orderId: ORDER_ID, status: 'paid' }, meta);
    expectTypeOf(notifyOnPaidHandler).toBeCallableWith(
      { orderId: ORDER_ID, status: 'paid' },
      { ...meta, signal: new AbortController().signal },
    );
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

  test('an implementation that takes no parameters and returns nothing type-checks', () => {
    const chargeCardHandler = handle(chargeCard, async () => {});
    const notifyOnPaidHandler = handle(notifyOnPaid, () => {});

    expectTypeOf(chargeCardHandler).toEqualTypeOf<CommandHandler<typeof chargeCard>>();
    expectTypeOf(notifyOnPaidHandler).toEqualTypeOf<EventHandler<typeof notifyOnPaid>>();
    expect(notifyOnPaidHandler.element).toBe(notifyOnPaidV1);
  });

  test('an Endpoint implementation that takes no parameters keeps its literal types', () => {
    const echoSmall = defineEndpoint({
      name: 'echoSmall',
      method: 'GET',
      path: '/small',
      visibility: 'public',
      description: 'Echoes a small literal',
      success: { status: 204, headers: z.object({ 'x-small': z.literal(1.5e-7) }) },
    });

    const echoSmallHandler = handle(echoSmall, () => success({ headers: { 'x-small': 1.5e-7 } }));

    expectTypeOf(echoSmallHandler).toEqualTypeOf<EndpointHandler<typeof echoSmall>>();
    expect(echoSmallHandler.element).toBe(echoSmall);
  });

  test('a Handler written for an Endpoint or a Guard has its Handler type', () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));
    const apiKeyHandler = handle(apiKey, () => admit({ callerId: 'c-1' }));

    expectTypeOf(getOrderHandler).toEqualTypeOf<EndpointHandler<typeof getOrder>>();
    expectTypeOf(apiKeyHandler).toEqualTypeOf<GuardHandler<typeof apiKey>>();
    expect(apiKeyHandler.element).toBe(apiKey);
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
      cause: new TypeError("apiKey's Handler returned no Admission but undefined"),
    });
  });
});

describe('handle and Resources', () => {
  type Orders = { readonly find: (orderId: string) => string | undefined };
  type OrdersTaken = { readonly orders: Orders };

  test('handle() infers the Resources an EndpointHandler takes from its last parameter', () => {
    const getOrderHandler = handle(
      getOrder,
      (_input, _call, { resources }: WithResources<OrdersTaken>) =>
        resources.orders.find(ORDER_ID) === undefined
          ? reject(notFound)
          : success({ id: ORDER_ID }),
    );

    expectTypeOf(getOrderHandler).toEqualTypeOf<EndpointHandler<typeof getOrder, OrdersTaken>>();
    expect(getOrderHandler.element).toBe(getOrder);
  });

  test('a direct call without the Resources the Handler takes is a type error, and one that takes none needs no last argument', () => {
    const takes = handle(getOrder, (_input, _call, { resources }: WithResources<OrdersTaken>) =>
      resources.orders.find(ORDER_ID) === undefined ? reject(notFound) : success({ id: ORDER_ID }),
    );
    const takesNone = handle(getOrder, () => reject(notFound));
    const input = { params: { orderId: ORDER_ID } };

    const calls = () => [
      // @ts-expect-error the Handler takes orders
      takes(input, {}),
      // @ts-expect-error the Handler takes orders
      takes(input, {}, { resources: {} }),
      takesNone(input, {}),
    ];

    expectTypeOf(takes).toBeCallableWith(input, {}, { resources: { orders: { find: () => '' } } });
    expectTypeOf(takesNone).toBeCallableWith(input, {});
    expect(calls).toBeDefined();
  });

  test('handle() infers the Resources a GuardHandler takes from its last parameter', () => {
    type CallersTaken = { readonly callers: { readonly byKey: (key: string) => string } };
    const apiKeyHandler = handle(
      apiKey,
      (_demands, _call, { resources }: WithResources<CallersTaken>) =>
        admit({ callerId: resources.callers.byKey('k') }),
    );
    const demands = { headers: { 'x-api-key': 'k' } };

    const calls = () => [
      // @ts-expect-error the Handler takes callers
      apiKeyHandler(demands, {}),
    ];

    expectTypeOf(apiKeyHandler).toEqualTypeOf<GuardHandler<typeof apiKey, CallersTaken>>();
    expectTypeOf(apiKeyHandler).toBeCallableWith(
      demands,
      {},
      { resources: { callers: { byKey: () => 'c-1' } } },
    );
    expect(calls).toBeDefined();
  });

  test('Needs<…> types a Qualifier Guard’s last parameter, its Qualifier in the second', () => {
    type Resources = { readonly permissions: { readonly held: readonly string[] } };
    type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;
    const permissionHandler = handle(
      permission,
      (_demands, { qualifier }, { resources: { permissions } }: Needs<'permissions'>) =>
        qualifier.every((code) => permissions.held.includes(code)) ? admit() : admit(),
    );

    expectTypeOf(permissionHandler).toEqualTypeOf<
      GuardHandler<typeof permission, Pick<Resources, 'permissions'>>
    >();
    expectTypeOf<
      ResourcesOf<{ guards: { permission: typeof permissionHandler } }>
    >().toEqualTypeOf<{
      readonly permissions: { readonly held: readonly string[] };
    }>();
  });

  test('handle() infers the Resources a Message Handler takes from its last parameter', () => {
    type NotificationsTaken = { readonly notifications: { readonly send: () => void } };
    const chargeCardHandler = handle(
      chargeCard,
      (_body, _meta, { resources }: WithResources<NotificationsTaken>) => {
        resources.notifications.send();
      },
    );
    const notifyOnPaidHandler = handle(
      notifyOnPaid,
      (_body, _meta, { resources }: WithResources<NotificationsTaken>) => {
        resources.notifications.send();
      },
    );
    const body = { orderId: ORDER_ID, status: 'paid' } as const;

    const calls = () => [
      // @ts-expect-error the Handler takes notifications
      chargeCardHandler(body, meta),
    ];

    expectTypeOf(chargeCardHandler).toEqualTypeOf<
      CommandHandler<typeof chargeCard, NotificationsTaken>
    >();
    expectTypeOf(notifyOnPaidHandler).toEqualTypeOf<
      EventHandler<typeof notifyOnPaid, NotificationsTaken>
    >();
    expectTypeOf(chargeCardHandler).toBeCallableWith(body, meta, {
      resources: { notifications: { send: () => undefined } },
    });
    expect(calls).toBeDefined();
  });

  test('a Handler that takes none, with an unannotated last parameter, finds its resources ResourcesNotAnnotated or undefined', () => {
    const handlers = [
      handle(getOrder, (_input, _call, last) => {
        expectTypeOf(last.resources).toEqualTypeOf<ResourcesNotAnnotated | undefined>();
        return reject(notFound);
      }),
      handle(chargeCard, (_body, _meta, last) => {
        expectTypeOf(last.resources).toEqualTypeOf<ResourcesNotAnnotated | undefined>();
      }),
      handle(notifyOnPaid, (_body, _meta, last) => {
        expectTypeOf(last.resources).toEqualTypeOf<ResourcesNotAnnotated | undefined>();
      }),
      handle(apiKey, (_demands, _call, last) => {
        expectTypeOf(last.resources).toEqualTypeOf<ResourcesNotAnnotated | undefined>();
        return admit({ callerId: 'c-1' });
      }),
    ];

    expect(handlers.map(({ element }) => element)).toEqual([
      getOrder,
      chargeCardV1,
      notifyOnPaidV1,
      apiKey,
    ]);
  });

  test('an unannotated Handler that destructures its resources is a type error naming ResourcesNotAnnotated', () => {
    const write = () =>
      // @ts-expect-error Property 'orders' does not exist on type 'ResourcesNotAnnotated | undefined'
      handle(getOrder, (_input, _call, { resources: { orders } }) =>
        orders === undefined ? reject(notFound) : success({ id: ORDER_ID }),
      );

    expect(write).toBeTypeOf('function');
  });

  test('an implementation whose last parameter holds anything beside resources is a type error', () => {
    type Orders = { readonly orders: { readonly find: (orderId: string) => string | undefined } };
    const written = (
      _input: unknown,
      _call: unknown,
      last: { readonly resources: Orders; readonly extra: number },
    ) => (last.extra === 0 ? reject(notFound) : success({ id: ORDER_ID }));
    const intersected = (
      _input: unknown,
      _call: unknown,
      last: WithResources<Orders> & { readonly extra: number },
    ) => (last.extra === 0 ? reject(notFound) : success({ id: ORDER_ID }));

    const write = () => [
      // @ts-expect-error the last parameter holds only resources
      handle(getOrder, written),
      // @ts-expect-error the last parameter holds only resources
      handle(getOrder, intersected),
    ];

    expect(write).toBeTypeOf('function');
  });

  test('a stub takes no Resources', () => {
    const getOrderStub = handle.stub(getOrder);
    const apiKeyStub = handle.stub(apiKey);

    expectTypeOf(getOrderStub).toEqualTypeOf<EndpointHandler<typeof getOrder>>();
    expectTypeOf(getOrderStub).toBeCallableWith({ params: { orderId: ORDER_ID } }, {});
    expectTypeOf(apiKeyStub).toBeCallableWith({ headers: { 'x-api-key': 'k' } }, {});
    expectTypeOf(handle.stub(chargeCard)).toBeCallableWith(
      { orderId: ORDER_ID, status: 'paid' },
      meta,
    );
  });
});

describe('ResourcesOf', () => {
  type Orders = { readonly find: (orderId: string) => string | undefined };
  type Callers = { readonly byKey: (key: string) => string };
  type Resources = { readonly orders: Orders; readonly callers: Callers };
  type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

  test('a Handler map holds every Resource any of its Handlers takes, and a stub takes none', () => {
    const handlers = {
      endpoints: {
        getOrder: handle(getOrder, (_input, _call, { resources }: Needs<'orders'>) =>
          resources.orders.find(ORDER_ID) === undefined
            ? reject(notFound)
            : success({ id: ORDER_ID }),
        ),
        findOrder: handle.stub(findOrder),
      },
      guards: {
        apiKey: handle(apiKey, (_demands, _call, { resources }: Needs<'callers'>) =>
          admit({ callerId: resources.callers.byKey('k') }),
        ),
      },
    };

    expectTypeOf<ResourcesOf<typeof handlers>>().toEqualTypeOf<{
      readonly orders: Orders;
      readonly callers: Callers;
    }>();
    expect(handlers.endpoints.getOrder.element).toBe(getOrder);
  });

  test('an implementation typed by its last parameter gives a Handler that takes those Resources', () => {
    const implementation: EndpointImplementation<typeof getOrder, Needs<'orders'>> = (
      _input,
      _call,
      { resources },
    ) =>
      resources.orders.find(ORDER_ID) === undefined ? reject(notFound) : success({ id: ORDER_ID });

    expectTypeOf(handle(getOrder, implementation)).toEqualTypeOf<
      EndpointHandler<typeof getOrder, Pick<Resources, 'orders'>>
    >();
  });

  test('handle() keeps the any an implementation types its Resources as, every kind alike', () => {
    /* biome-ignore-start lint/suspicious/noExplicitAny: the any this test is about */
    const handlers = [
      handle(getOrder, (_input, _call, { resources }: WithResources<any>) =>
        resources ? reject(notFound) : success({ id: ORDER_ID }),
      ),
      handle(apiKey, (_demands, _call, { resources }: WithResources<any>) =>
        admit({ callerId: resources.callerId }),
      ),
      handle(chargeCard, (_body, _meta, { resources }: WithResources<any>) => {
        resources.notifications.send();
      }),
      handle(notifyOnPaid, (_body, _meta, { resources }: WithResources<any>) => {
        resources.notifications.send();
      }),
      handle<typeof getOrder, any>(getOrder, () => reject(notFound)),
      handle(getOrder, (_input, _call, last: any) => (last ? reject(notFound) : reject(notFound))),
    ] as const;

    expectTypeOf(handlers[0]).toEqualTypeOf<EndpointHandler<typeof getOrder, any>>();
    expectTypeOf(handlers[1]).toEqualTypeOf<GuardHandler<typeof apiKey, any>>();
    expectTypeOf(handlers[2]).toEqualTypeOf<CommandHandler<typeof chargeCard, any>>();
    expectTypeOf(handlers[3]).toEqualTypeOf<EventHandler<typeof notifyOnPaid, any>>();
    expectTypeOf(handlers[4]).toEqualTypeOf<EndpointHandler<typeof getOrder, any>>();
    expectTypeOf(handlers[5]).toEqualTypeOf<EndpointHandler<typeof getOrder, any>>();
    /* biome-ignore-end lint/suspicious/noExplicitAny: the any this test is about */
    expect(handlers.map(({ element }) => element)).toEqual([
      getOrder,
      apiKey,
      chargeCardV1,
      notifyOnPaidV1,
      getOrder,
      getOrder,
    ]);
  });

  test('a Handler whose Resources are any makes ResourcesOf name the cause', () => {
    // biome-ignore lint/suspicious/noExplicitAny: the any this test is about
    const loose = handle(getOrder, (_input, _call, { resources }: WithResources<any>) =>
      resources ? reject(notFound) : success({ id: ORDER_ID }),
    );
    const handlers = { endpoints: { getOrder: loose } };

    expectTypeOf<ResourcesOf<typeof handlers>>().toHaveProperty(
      'A Handler types its Resources as any: type them, as Needs<…> does',
    );
  });

  test('a Handler map none of whose Handlers takes Resources holds none', () => {
    const handlers = {
      endpoints: { getOrder: handle(getOrder, () => reject(notFound)) },
      guards: { apiKey: handle.stub(apiKey) },
    };

    expectTypeOf<ResourcesOf<typeof handlers>>().toEqualTypeOf<Readonly<Record<never, never>>>();
    expectTypeOf<
      ResourcesOf<{ endpoints: Record<never, never>; guards: Record<never, never> }>
    >().toEqualTypeOf<Readonly<Record<never, never>>>();
    expect(handlers.guards.apiKey.element).toBe(apiKey);
  });

  test('the Resources of Handlers that take the same key are the intersection of what they take', () => {
    type Narrow = { readonly orders: { readonly find: () => string } };
    const handlers = {
      endpoints: {
        getOrder: handle(getOrder, (_input, _call, { resources }: Needs<'orders'>) =>
          resources.orders.find(ORDER_ID) === undefined
            ? reject(notFound)
            : success({ id: ORDER_ID }),
        ),
        findOrder: handle(findOrder, (_input, _call, { resources }: WithResources<Narrow>) =>
          resources.orders.find() === undefined ? reject(notFound) : success({ id: ORDER_ID }),
        ),
      },
    };

    expectTypeOf<ResourcesOf<typeof handlers>>().toEqualTypeOf<{
      readonly orders: Orders & Narrow['orders'];
    }>();
    expect(handlers.endpoints.findOrder.element).toBe(findOrder);
  });
});

describe('readersOf', () => {
  test('readersOf returns the table and each of its pairings frozen', () => {
    const table = readersOf({
      commands: { chargeCardV1: { element: chargeCardV1, reader: statusReader } },
      subscriptions: { notifyOnPaid: { element: notifyOnPaidV1, reader: statusReader } },
    });

    const frozen = [
      table,
      table.commands,
      table.subscriptions,
      table.commands.chargeCardV1,
      table.subscriptions.notifyOnPaid,
    ].map(Object.isFrozen);

    expect(frozen).toEqual([true, true, true, true, true]);
  });

  test('readersOf keeps each pairing as written, typed by its Reader', () => {
    const table = readersOf({
      commands: { chargeCardV1: { element: chargeCardV1, reader: statusReader } },
      subscriptions: {},
    });

    expectTypeOf(table.commands.chargeCardV1.reader).toEqualTypeOf<typeof statusReader>();
    expect(table.commands.chargeCardV1.element).toBe(chargeCardV1);
  });

  test.each([
    ['an Endpoint', 'commands.x', { commands: { x: { element: getOrder, reader: statusReader } } }],
    [
      'a copy of a Command',
      'commands.x',
      { commands: { x: { element: { ...chargeCardV1 }, reader: statusReader } } },
    ],
    [
      'a Command with no zod schema',
      'commands.x',
      { commands: { x: { element: chargeCardV1, reader: { _zod: {} } } } },
    ],
    [
      'a Subscription with no Reader',
      'subscriptions.x',
      { subscriptions: { x: { element: notifyOnPaidV1 } } },
    ],
  ])('readersOf given %s names the key it refuses', (_what, key, pairing) => {
    const pair = () => readersOf({ commands: {}, subscriptions: {}, ...pairing } as never);

    expect(pair).toThrow(
      `readersOf() takes commands and subscriptions, each a Command or Subscription declared with @cf-loom/contract and a zod schema: ${key}`,
    );
  });

  test.each([
    ['commands', { subscriptions: {} }],
    ['subscriptions', { commands: {} }],
  ])('readersOf given a table without %s names it', (key, tables) => {
    const pair = () => readersOf(tables as never);

    expect(pair).toThrow(
      `readersOf() takes commands and subscriptions, each a Command or Subscription declared with @cf-loom/contract and a zod schema: ${key}`,
    );
  });
});

describe('HandlerMap', () => {
  test('takes Handlers of Commands by name in code and of Subscriptions by name', () => {
    const generated = {
      endpoints: {},
      guards: {},
      commands: { chargeCardV1: handle.stub(chargeCard) },
      subscriptions: { notifyOnPaid: handle.stub(notifyOnPaid) },
      readers,
      deprecatedAt: {},
    };

    const map: HandlerMap = generated;

    expectTypeOf(generated).toExtend<HandlerMap>();
    const { notifyOnPaid: mapped } = map.subscriptions;
    expect(mapped?.element).toBe(notifyOnPaidV1);
  });

  test('refuses a map whose commands hold the Handler of an Endpoint', () => {
    const generated = {
      endpoints: {},
      guards: {},
      commands: { chargeCardV1: handle.stub(getOrder) },
      subscriptions: {},
      readers,
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
      readers: readersOf({ commands: {}, subscriptions: {} }),
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
      readers,
      deprecatedAt: {},
    };

    expectTypeOf(generated).not.toExtend<HandlerMap>();
    expect(generated.endpoints.getOrder()).toBeUndefined();
  });

  test('refuses a map without the readers the readers file exports', () => {
    const generated = {
      endpoints: {},
      guards: {},
      commands: {},
      subscriptions: {},
      deprecatedAt: {},
    };

    expectTypeOf(generated).not.toExtend<HandlerMap>();
    expect(generated.commands).toEqual({});
  });

  test('refuses a map whose readers are no pairings of Commands and Subscriptions', () => {
    const generated = {
      endpoints: {},
      guards: {},
      commands: {},
      subscriptions: {},
      readers: {
        commands: { chargeCardV1: { element: getOrder, reader: statusReader } },
        subscriptions: {},
      },
      deprecatedAt: {},
    };

    expectTypeOf(generated).not.toExtend<HandlerMap>();
    expect(generated.readers.commands.chargeCardV1.element).toBe(getOrder);
  });
});
