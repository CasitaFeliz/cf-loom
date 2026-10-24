import {
  defineEndpoint,
  defineEvent,
  defineGuard,
  defineRejection,
  defineSubscription,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { admit, handle, isRejectionOf, reject, success, withReader } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const money = z.object({ amount: z.int(), currency: z.string() });

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
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
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
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
const callers = { byKey: async (key: string) => (key === 'key-1' ? { id: 'c-1' } : undefined) };
const permissions = { of: async (_userId: string): Promise<string[]> => ['orders:edit'] };

const getOrderHandler = handle(getOrder, async ({ params }, context) => {
  const order = await orders.find(params.orderId, context.apiKey.callerId);
  if (!order) return reject(notFound);
  if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success({ id: order.id, status: order.status, total: order.total });
});

const apiKeyHandler = handle(apiKey, async ({ headers }) => {
  const caller = await callers.byKey(headers['x-api-key']);
  if (!caller) return reject(unauthenticated);
  return admit({ callerId: caller.id });
});

const permissionHandler = handle(permission, async (_demands, { userToken }, { qualifier }) => {
  const held = await permissions.of(userToken.userId);
  const granted = qualifier.every((code) => held.includes(code));
  return granted ? admit() : reject(forbidden);
});

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled, as its Contract Package declares it with its Reader',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});

const notifyOnSettled = withReader(
  defineSubscription({ name: 'notify-on-settled', event: paymentSettledV1 }),
  paymentSettledV1.body,
);

const sent: unknown[] = [];
const notifications = { send: async (...given: unknown[]) => void sent.push(given) };

const notifyOnSettledHandler = handle(
  notifyOnSettled,
  async (body, { messageId, factId, deliveryCount, headers }) => {
    await notifications.send(body.paymentId, { messageId, factId, deliveryCount, headers });
  },
);

describe('the handlers README', () => {
  test('the direct call of an EventHandler receives its body and meta, headers defaulting to {}', async () => {
    const settled = { paymentId: 'pay-1', method: { unknown: 'wallet' } };

    const answer = await notifyOnSettledHandler(settled, {
      messageId: 'PaymentSettled.v1:pay-1',
      factId: 'pay-1',
      deliveryCount: 1,
    });

    expect(answer).toBeUndefined();
    expect(sent).toEqual([
      [
        'pay-1',
        { messageId: 'PaymentSettled.v1:pay-1', factId: 'pay-1', deliveryCount: 1, headers: {} },
      ],
    ]);
  });

  test('the EndpointHandler example answers its Success', async () => {
    const outcome = await getOrderHandler(
      { params: { orderId: ORDER_ID } },
      { apiKey: { callerId: 'c-1' } },
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
      { apiKey: { callerId: 'c-2' } },
    );

    expect(isRejectionOf(outcome, notFound)).toBe(true);
  });

  test('the GuardHandler example admits a known key and rejects an unknown one', async () => {
    const admissions = [
      await apiKeyHandler({ headers: { 'x-api-key': 'key-1' } }, {}),
      await apiKeyHandler({ headers: { 'x-api-key': 'key-2' } }, {}),
    ];

    expect(admissions).toMatchObject([
      { kind: 'admitted', context: { callerId: 'c-1' } },
      { kind: 'rejection', rejection: unauthenticated },
    ]);
  });

  test('the permission example reads the Context of the Guards it lists and its Qualifier', async () => {
    const admissions = [
      await permissionHandler(
        {},
        { userToken: { userId: 'u-1' } },
        {
          qualifier: ['orders:edit'],
        },
      ),
      await permissionHandler(
        {},
        { userToken: { userId: 'u-1' } },
        {
          qualifier: ['customers:read'],
        },
      ),
    ];

    expect(admissions).toMatchObject([
      { kind: 'admitted' },
      { kind: 'rejection', rejection: forbidden },
    ]);
  });
});
