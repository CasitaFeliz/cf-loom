import type { Scope } from './readme-snippets.ts';

/**
 * The files of the Service the READMEs describe that no README block shows: the rest of its
 * Definitions Package, an Endpoint and its Handler, the generated files, and the code the Service
 * writes itself, which the READMEs leave to it. A README block shows everything else.
 */
export const readmeScope: Scope = {
  '@org/definitions': "export * from '../../definitions/src/definitions/index.ts';",
  'definitions/src/definitions/guards/user-token.guard.ts': `
export const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
  rejections: [unauthenticated],
});`,
  'definitions/src/definitions/rejections/forbidden.rejection.ts': `
export const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });`,
  'definitions/src/definitions/schemas/money.schema.ts': `
export const money = z.object({ amount: z.int(), currency: z.string() });`,
  'definitions/src/definitions/schemas/pagination.schema.ts': `
export const pagination = z.object({ limit: z.int(), cursor: z.string().optional() });`,

  '@org/contract-payments-service': `
import { openEnumReader, providedEndpoint, providedEvent } from '@cf-loom/contract';
import { z } from 'zod';

const payments = {
  name: 'payments-service',
  standardRejections: {
    invalidInput: {
      code: 'BAD_REQUEST',
      status: 400,
      message: 'The request is invalid',
      body: z.object({ issues: z.array(z.object({ message: z.string() })) }),
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
} as const;

export const getPaymentEndpoint = providedEndpoint(payments, {
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.string() }) },
  success: { status: 200, body: z.object({ paymentId: z.string() }) },
}, null);

export const paymentSettledEventV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});`,

  'src/contract/endpoints/orders/create-order.endpoint.ts': `
import { apiKey, money } from '@org/definitions';

export const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Places a pending order',
  guards: [apiKey],
  input: { body: z.object({ customerId: z.uuid(), total: money }) },
  success: { status: 201, body: z.object({ id: z.uuid() }) },
});`,
  'src/endpoints/orders/create-order.handler.ts': `
import { handle, success } from '@cf-loom/handlers';
import { createOrder } from '../../contract/endpoints/orders/create-order.endpoint.ts';
import type { Needs } from '../../resources.ts';

export default handle(
  createOrder,
  async (_input, _call, { resources: { publisher } }: Needs<'publisher' | 'sender'>) => {
    void publisher;
    return success({ id: crypto.randomUUID() });
  },
);`,
  'src/handlers.generated.ts': `
import type { HandlerMapOf, NoResources } from '@cf-loom/handlers';
import type { contract } from './contract/index.ts';

/** Generated, and typed by the Resources the Service's Handlers take, which differ by README. */
declare const handlers: HandlerMapOf<typeof contract, NoResources>;
export default handlers;`,
  'src/readers.generated.ts': `
import { readersOf } from '@cf-loom/handlers';
import { paymentSettledEventV1 } from '@org/contract-payments-service';
import { chargeCardV1 } from './contract/commands/orders/charge-card.v1.command.ts';
import { notifyOnSettled } from './contract/subscriptions/orders/notify-on-settled.subscription.ts';

export const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {
    notifyOnSettled: { declaration: notifyOnSettled, reader: paymentSettledEventV1.body },
  },
});`,

  'src/service-code.ts': `
import type { MessageMeta } from '@cf-loom/handlers';
import type { Broker, CommandSender, EventPublisher } from '@cf-loom/messaging';
import type { BrokerLimits, BrokerPlan, JetStreamConnecting } from '@cf-loom/messaging/jetstream';
import type { contract } from './contract/index.ts';
import type { Resources } from './resources.ts';

export type Orders = {
  find(orderId: string, callerId: string): Promise<
    { id: string; status: 'pending' | 'paid'; total: { amount: number; currency: string }; locked: boolean; lockedAt: string } | undefined
  >;
};
export type Callers = { byKey(key: string | undefined): Promise<{ id: string } | undefined> };
export type Permissions = { of(userId: string): Promise<string[]> };
export type Notifications = { send(paymentId: string): Promise<void> };

export declare function ordersRepository(): Promise<Orders>;
export declare function mongoOrders(): Promise<Orders>;
export declare function mongoCallers(): Promise<Callers>;
export declare function mongoPermissions(): Promise<Permissions>;
export declare function mongoNotifications(): Promise<Notifications>;
export declare function preflight(request: Request): Response;

export declare const resources: Resources;
export declare const orders: Orders;
export declare const notifications: Notifications;
export declare const ORDER_ID: string;
export declare const baseUrl: string;
export declare const broker: Broker;
export declare const plan: BrokerPlan;
export declare const limits: BrokerLimits;
export declare const connecting: JetStreamConnecting;
export declare const newOrder: { customerId: string; total: { amount: number; currency: string } };
export declare const body: { paymentId: string; method: 'card' | 'transfer' };

export declare const publisher: EventPublisher<typeof contract>;
export declare const sender: CommandSender<typeof contract>;
export declare const orderId: string;
export declare const total: { amount: number; currency: string };
export declare const order: { id: string };
export declare const meta: MessageMeta;`,
};
