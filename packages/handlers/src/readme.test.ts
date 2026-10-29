import {
  type BodyOf,
  defineCommand,
  defineEndpoint,
  defineEvent,
  defineGuard,
  defineRejection,
  defineSubscription,
  notFound,
  openEnum,
  openEnumReader,
  providedEvent,
} from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  admit,
  type DirectMeta,
  handle,
  isRejectionOf,
  type MessageHandler,
  type MessageImplementation,
  type ReceivedBodyOf,
  type ResourcesOf,
  readersOf,
  reject,
  success,
  type WithResources,
} from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const money = z.object({ amount: z.int(), currency: z.string() });

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is missing or unknown',
  headers: z.object({ 'www-authenticate': z.string() }),
});

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string().optional() }) },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
  rejections: [unauthenticated],
});

const permissionCode = z.enum(['orders:read', 'orders:edit', 'customers:read']);

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(permissionCode).min(1),
  rejections: [forbidden],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: {
    status: 200,
    body: z.object({ id: z.uuid(), status: openEnum(['pending', 'paid']), total: money }),
  },
  rejections: [notFound, orderLocked],
});

type Order = {
  id: string;
  callerId: string;
  status: 'pending' | 'paid';
  total: { amount: number; currency: string };
  locked: boolean;
  lockedAt: string;
};

const stored: Order = {
  id: ORDER_ID,
  callerId: 'c-1',
  status: 'paid',
  total: { amount: 1200, currency: 'EUR' },
  locked: false,
  lockedAt: '2026-10-18T10:00:00Z',
};

const orders = {
  find: async (orderId: string, callerId: string) =>
    orderId === stored.id && callerId === stored.callerId ? stored : undefined,
};
const callers = {
  byKey: async (key: string | undefined) => (key === 'key-1' ? { id: 'c-1' } : undefined),
};
const permissions = { of: async (_userId: string): Promise<string[]> => ['orders:edit'] };
const sent: unknown[] = [];
const notifications = { send: async (...given: unknown[]) => void sent.push(given) };

type Resources = {
  readonly orders: typeof orders;
  readonly callers: typeof callers;
  readonly permissions: typeof permissions;
  readonly notifications: typeof notifications;
};
type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

const resources: Resources = { orders, callers, permissions, notifications };

const getOrderHandler = handle(
  getOrder,
  async ({ params }, { context }, { resources: { orders } }: Needs<'orders'>) => {
    const order = await orders.find(params.orderId, context.apiKey.callerId);
    if (!order) return reject(notFound);
    if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
    return success({ id: order.id, status: order.status, total: order.total });
  },
);

const apiKeyHandler = handle(
  apiKey,
  async ({ headers }, _call, { resources: { callers } }: Needs<'callers'>) => {
    const caller = await callers.byKey(headers['x-api-key']);
    if (!caller) {
      return reject(unauthenticated, { headers: { 'www-authenticate': 'ApiKey realm="orders"' } });
    }
    return admit({ callerId: caller.id });
  },
);

const permissionHandler = handle(
  permission,
  async (
    _demands,
    { context: { userToken }, qualifier },
    { resources: { permissions } }: Needs<'permissions'>,
  ) => {
    const held = await permissions.of(userToken.userId);
    const granted = qualifier.every((code) => held.includes(code));
    return granted ? admit() : reject(forbidden);
  },
);

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled, as its Contract Package declares it with its Reader',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});

const notifyOnSettledSubscription = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notify on settled',
  event: paymentSettledV1,
});

const readers = readersOf({
  commands: {},
  subscriptions: {
    notifyOnSettled: { declaration: notifyOnSettledSubscription, reader: paymentSettledV1.body },
  },
});

const notifyOnSettled = readers.subscriptions.notifyOnSettled;

const notifyOnSettledHandler = handle(
  notifyOnSettled,
  async (
    body,
    { messageId, factId, deliveryCount, headers },
    { resources: { notifications } }: Needs<'notifications'>,
  ) => {
    await notifications.send(body.paymentId, { messageId, factId, deliveryCount, headers });
  },
);

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.string(), status: openEnum(['pending', 'paid']) }),
});

const chargeOnCreatedSubscription = defineSubscription({
  name: 'chargeOnCreated',
  description: 'Charge on created',
  event: orderCreatedV2,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string(), method: openEnum(['card', 'transfer']) }),
});

const ownReaders = readersOf({
  commands: {
    chargeCardV1: {
      declaration: chargeCardV1,
      reader: z.object({ orderId: z.string(), method: openEnumReader(['card', 'transfer']) }),
    },
  },
  subscriptions: {
    chargeOnCreated: {
      declaration: chargeOnCreatedSubscription,
      reader: z.object({ orderId: z.string(), status: openEnumReader(['pending', 'paid']) }),
    },
  },
});

describe('the handlers README', () => {
  test("the direct call of a Subscription's Message Handler receives its body and its meta defaulted", async () => {
    const settled = { paymentId: 'pay-1', method: { unknown: 'wallet' } };

    const answer = await notifyOnSettledHandler(settled, {}, { resources });

    expect(answer).toBeUndefined();
    const [[paymentId, meta]] = sent as [[string, { factId: string }]];
    expect(paymentId).toBe('pay-1');
    expect(meta).toEqual({
      messageId: `event.PaymentSettled.v1:${meta.factId}`,
      factId: expect.any(String),
      deliveryCount: 1,
      headers: {},
    });
  });

  test('DirectMeta types the meta a direct call takes, each part of MessageMeta optional', async () => {
    const meta: DirectMeta = { factId: 'f-1', deliveryCount: 2 };

    await notifyOnSettledHandler({ paymentId: 'pay-1', method: 'card' }, meta, { resources });

    expectTypeOf<Parameters<typeof notifyOnSettledHandler>[1]>().toEqualTypeOf<
      DirectMeta | undefined
    >();
    expect(sent.at(-1)).toEqual([
      'pay-1',
      { messageId: 'event.PaymentSettled.v1:f-1', factId: 'f-1', deliveryCount: 2, headers: {} },
    ]);
  });

  test('the EndpointHandler example answers its Success', async () => {
    const outcome = await getOrderHandler(
      { params: { orderId: ORDER_ID } },
      { context: { apiKey: { callerId: 'c-1' } } },
      { resources: { orders } },
    );

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      body: { id: ORDER_ID, status: 'paid', total: { amount: 1200, currency: 'EUR' } },
    });
  });

  test('the EndpointHandler example answers not found, told by its declaration', async () => {
    const outcome = await getOrderHandler(
      { params: { orderId: ORDER_ID } },
      { context: { apiKey: { callerId: 'c-2' } } },
      { resources: { orders } },
    );

    expect(isRejectionOf(outcome, notFound)).toBe(true);
  });

  test('the GuardHandler example admits a known key and rejects an unknown one', async () => {
    const admissions = [
      await apiKeyHandler({ headers: { 'x-api-key': 'key-1' } }, {}, { resources }),
      await apiKeyHandler({ headers: { 'x-api-key': 'key-2' } }, {}, { resources }),
    ];

    expect(admissions).toMatchObject([
      { kind: 'admitted', context: { callerId: 'c-1' } },
      { kind: 'rejection', rejection: unauthenticated },
    ]);
  });

  test('the GuardHandler example rejects a request without a key as unauthenticated', async () => {
    const admission = await apiKeyHandler({ headers: {} }, {}, { resources });

    expect(admission).toMatchObject({ kind: 'rejection', rejection: unauthenticated });
  });

  test('the GuardHandler example answers unauthenticated with its www-authenticate header', async () => {
    const admission = await apiKeyHandler({ headers: {} }, {}, { resources });

    expect(admission).toMatchObject({
      kind: 'rejection',
      headers: { 'www-authenticate': 'ApiKey realm="orders"' },
    });
  });

  test('the permission example reads the Context of the Guards it lists and its Qualifier', async () => {
    const context = { userToken: { userId: 'u-1' } };
    const admissions = [
      await permissionHandler({}, { context, qualifier: ['orders:edit'] }, { resources }),
      await permissionHandler({}, { context, qualifier: ['customers:read'] }, { resources }),
    ];

    expect(admissions).toMatchObject([
      { kind: 'admitted' },
      { kind: 'rejection', rejection: forbidden },
    ]);
  });

  test('ResourcesOf a map holds the Resources its Handlers take together', () => {
    const handlers = {
      endpoints: { getOrder: getOrderHandler },
      guards: { apiKey: apiKeyHandler, permission: permissionHandler },
      commands: {},
      subscriptions: { notifyOnSettled: notifyOnSettledHandler },
    };

    expectTypeOf<ResourcesOf<typeof handlers>>().toEqualTypeOf<
      Pick<Resources, 'orders' | 'callers' | 'permissions' | 'notifications'>
    >();
    expect(handlers.endpoints.getOrder.declaration).toBe(getOrder);
  });

  test("ReceivedBodyOf of a Subscription's pairing has the Unknown case its own Event's writer type lacks", () => {
    type Created = ReceivedBodyOf<typeof ownReaders.subscriptions.chargeOnCreated>;
    const statusOf = (body: Created) => body.status;

    const handler = handle(ownReaders.subscriptions.chargeOnCreated, (body) => {
      statusOf(body);
    });

    expectTypeOf<Created>().toEqualTypeOf<{
      orderId: string;
      status: 'pending' | 'paid' | { unknown: string };
    }>();
    expectTypeOf<Created>().not.toEqualTypeOf<BodyOf<typeof orderCreatedV2>>();
    expectTypeOf<BodyOf<typeof orderCreatedV2>>().toExtend<Created>();
    expect(handler.declaration).toBe(chargeOnCreatedSubscription);
  });

  test('a Message Handler’s implementation receives ReceivedBodyOf of its pairing, a Command’s and a Subscription’s', () => {
    type Charge = typeof ownReaders.commands.chargeCardV1;
    type Created = typeof ownReaders.subscriptions.chargeOnCreated;

    expectTypeOf<Parameters<MessageImplementation<Charge>>[0]>().toEqualTypeOf<
      ReceivedBodyOf<Charge>
    >();
    expectTypeOf<Parameters<MessageHandler<Created>>[0]>().toEqualTypeOf<ReceivedBodyOf<Created>>();
    expectTypeOf<Parameters<MessageImplementation<Created>>[0]>().toEqualTypeOf<
      ReceivedBodyOf<Created>
    >();
    expectTypeOf<Parameters<MessageHandler<Charge>>[0]>().toEqualTypeOf<ReceivedBodyOf<Charge>>();
    expectTypeOf<ReceivedBodyOf<Charge>>().toEqualTypeOf<{
      orderId: string;
      method: 'card' | 'transfer' | { unknown: string };
    }>();
  });
});
