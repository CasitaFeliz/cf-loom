import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aProvider } from '../test/providers.ts';
import {
  defineApplication,
  defineCommand,
  defineDefinitions,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  notFound,
  openEnum,
  providedEndpoint,
  providedEvent,
} from './index.ts';

const money = z.object({ amount: z.int(), currency: z.string() });
const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is missing or unknown',
  headers: z.object({ 'www-authenticate': z.string() }),
});
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
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

const definitions = defineDefinitions({
  standardRejections: {
    invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
});

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: {
    headers: z.object({ 'x-api-key': z.string().optional() }),
  },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: {
    params: z.object({ orderId: z.uuid() }),
  },
  success: {
    status: 200,
    body: z.object({
      id: z.uuid(),
      status: openEnum(['pending', 'paid']),
      total: money,
    }),
  },
  rejections: [notFound, orderLocked],
});

const payment = z.object({
  type: openEnum(['card', 'transfer']),
  last4: z.string().optional(),
  iban: z.string().optional(),
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Creates an order',
  guards: [apiKey],
  input: {
    body: z.object({ total: money, payment }),
  },
  success: { status: 201, body: z.object({ id: z.uuid() }) },
});

const getPaymentEndpoint = providedEndpoint(
  aProvider('payments-service'),
  {
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'public',
    description: 'One payment by id',
    input: { params: z.object({ paymentId: z.uuid() }) },
    success: { status: 200, body: z.object({ amount: money }) },
    rejections: [notFound],
  },
  undefined,
);

const paymentSettledEventV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const paymentsDependency = defineDependency({ endpoints: [getPaymentEndpoint] });

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was placed, with its total',
  body: z.object({ orderId: z.uuid(), total: money }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the card an order is paid with',
  body: z.object({ orderId: z.uuid() }),
});

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  lifecycle: 'deprecated',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: paymentSettledEventV1,
});

const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
  subscriptions: [notifyOnSettled],
});

describe('the README’s declaration examples', () => {
  test('a Service’s Root names its Standard Rejections’ package, lists its Groups, which list its Elements and Subscriptions, and its Dependencies', () => {
    const contract = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: [ordersGroup],
      dependencies: [paymentsDependency],
    });

    expect(contract.groups[0].endpoints[0].success.body.shape.total).toBe(money);
    expect(contract.groups[0].subscriptions[0].event).toBe(paymentSettledEventV1);
  });

  test('an Application depends on the Public Endpoints of each Provider', () => {
    const adminPaymentsDependency = defineDependency({ endpoints: [getPaymentEndpoint] });

    const application = defineApplication({
      name: 'web-admin',
      dependencies: [adminPaymentsDependency],
    });

    expect(application.dependencies[0].endpoints).toEqual([getPaymentEndpoint]);
  });
});

describe('the README’s Event and Command examples', () => {
  test('an Event takes a Visibility', () => {
    expect(orderCreatedV2).toMatchObject({ kind: 'event', visibility: 'internal' });
  });

  test('a Deprecated Endpoint states the instant it is Deprecated as of', () => {
    const listOrders = defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'Every order',
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
      success: { status: 200, body: z.array(z.object({ orderId: z.uuid() })) },
    });

    expect(listOrders).toMatchObject({
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
    });
  });

  test('a Deprecated Event version sits beside the Active one', () => {
    expect(orderCreatedV1.lifecycle).toBe('deprecated');
    expect(orderCreatedV2).toStrictEqual({
      kind: 'event',
      name: 'OrderCreated',
      version: 2,
      visibility: 'internal',
      description: 'An order was placed, with its total',
      body: orderCreatedV2.body,
    });
  });
});

describe('the README’s Subscription example', () => {
  test('a Subscription takes a Provider’s Event from its Contract Package', () => {
    expect(notifyOnSettled.event).toBe(paymentSettledEventV1);
  });

  test('the Dependency holds the Endpoints it calls, as listed, and no Event', () => {
    expect(paymentsDependency).toEqual({ kind: 'dependency', endpoints: [getPaymentEndpoint] });
  });
});

describe('the README’s Guard examples', () => {
  test('the Guard leaves the key optional, so its Handler decides on a request without one', () => {
    const withoutKey = apiKey.demands.headers.safeParse({});

    expect(withoutKey.success).toBe(true);
  });

  test('an Endpoint lists every Guard itself, in order', () => {
    const updateOrder = defineEndpoint({
      name: 'updateOrder',
      method: 'PUT',
      path: '/orders/:orderId',
      visibility: 'public',
      description: 'Replaces one order',
      guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
      input: { params: z.object({ orderId: z.uuid() }), body: z.object({ total: money }) },
      success: { status: 204 },
    });

    expect(updateOrder.guards[1].qualifier).toEqual(['orders:edit']);
  });
});
