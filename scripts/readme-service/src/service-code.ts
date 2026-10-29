import { client, type ReceivedOutcome } from '@cf-loom/client';
import type { MessageMeta } from '@cf-loom/handlers';
import { type Broker, messaging, type OutgoingMessage } from '@cf-loom/messaging';
import type {
  BrokerPlan,
  JetStreamBrokerLimits,
  JetStreamConnecting,
} from '@cf-loom/messaging/jetstream';
import { paymentsDependency } from './contract/dependencies/payments-service.dependency.ts';
import { contract } from './contract/index.ts';
import type { Resources } from './resources.ts';

type Money = { amount: number; currency: string };

export type Orders = {
  find(
    orderId: string,
    callerId: string,
  ): Promise<
    | {
        id: string;
        status: 'pending' | 'paid';
        total: Money;
        locked: boolean;
        lockedAt: string;
      }
    | undefined
  >;
};
export type Callers = { byKey(key: string | undefined): Promise<{ id: string } | undefined> };
export type Permissions = { of(userId: string): Promise<string[]> };
export type Notifications = { send(paymentId: string): Promise<void> };

export const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';
export const baseUrl = 'http://payments.test';
export const settings = { paymentsKey: 'k-pay' };

const stored = {
  id: ORDER_ID,
  callerId: 'c-1',
  status: 'paid',
  total: { amount: 1200, currency: 'EUR' },
  locked: false,
  lockedAt: '2026-10-18T10:00:00Z',
} as const;
const sent: string[] = [];
/** The orders whose ChargeCard v1 the Service handled, in the order it handled them. */
export const charged: string[] = [];
/** Each Message the Service handed its Broker, in the order it handed them. */
export const published: OutgoingMessage[] = [];
/** Each Outcome of getPayment the settlePayment Handler received, in the order it received them. */
export const received: ReceivedOutcome<typeof paymentsDependency, 'getPayment'>[] = [];

export const orders: Orders = {
  find: async (orderId, callerId) =>
    orderId === stored.id && callerId === stored.callerId ? stored : undefined,
};
export const callers: Callers = {
  byKey: async (key) => (key === 'k-1' ? { id: 'c-1' } : undefined),
};
export const permissions: Permissions = {
  of: async (userId) => (userId === 'u-1' ? ['orders:edit'] : []),
};
export const notifications: Notifications & { readonly sent: readonly string[] } = {
  send: async (paymentId) => void sent.push(paymentId),
  sent,
};

/** Puts what the Service's code kept back as it began, for a test's `beforeEach`. */
export function resetServiceCode(): void {
  sent.length = 0;
  charged.length = 0;
  published.length = 0;
  received.length = 0;
}

export async function ordersRepository(): Promise<Orders> {
  return orders;
}
export async function mongoOrders(): Promise<Orders> {
  return orders;
}
export async function mongoCallers(): Promise<Callers> {
  return callers;
}
export async function mongoPermissions(): Promise<Permissions> {
  return permissions;
}
export async function mongoNotifications(): Promise<Notifications> {
  return notifications;
}
export function preflight(_request: Request): Response {
  return new Response(null, { status: 204 });
}

export const broker: Broker = {
  connect: async () => ({
    publish: async (message) => {
      published.push(message);
      return { duplicate: false };
    },
    consume: async () => undefined,
    close: async () => undefined,
  }),
};
const running = await messaging(contract, broker);
export const publisher = running.publisher;
export const sender = running.sender;

export const resources: Resources = {
  orders,
  callers,
  permissions,
  payments: client(paymentsDependency, { baseUrl }),
  notifications,
  publisher,
  sender,
};

export const plan: BrokerPlan = { prefix: null, streams: {}, durableConsumers: {} };
export const limits: JetStreamBrokerLimits = {};
export const connecting: JetStreamConnecting = {
  connect: () => Promise.reject(new Error('The README Service has no NATS to connect to')),
};

export const total: Money = { amount: 1200, currency: 'EUR' };
export const orderId = ORDER_ID;
export const order = { id: ORDER_ID };
export const newOrder = { customerId: '5d0b2a10-6f35-4c43-9c1e-0a1b2c3d4e5f', total };
export const body = { paymentId: 'pay-1', method: 'card' } as const;
export const meta: MessageMeta = {
  messageId: 'event.PaymentSettled.v1:f-1',
  factId: 'f-1',
  deliveryCount: 1,
  lastAttempt: false,
  headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
  signal: new AbortController().signal,
};
