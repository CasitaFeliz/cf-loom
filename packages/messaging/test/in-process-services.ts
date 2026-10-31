import {
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEvent,
  type ServiceContract,
} from '@cf-loom/contract';
import { handle, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import type { InProcessBrokerLimits } from '../src/in-process/index.ts';
import { type Broker, type MessagingOptions, messaging } from '../src/index.ts';
import type { Received } from './orders.ts';

const orderBody = z.object({ orderId: z.string() });

/** Orders' Event as billing-service's Contract Package declares it. */
const orderCreatedV1 = providedEvent('orders-service', {
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const invoiceIssuedV1 = defineEvent({
  name: 'InvoiceIssued',
  version: 1,
  visibility: 'internal',
  description: 'An invoice was issued',
  body: orderBody,
});

const invoiceOnCreated = defineSubscription({
  name: 'invoiceOnCreated',
  description: 'Invoice an order once it is created',
  event: orderCreatedV1,
});

/** A Service that subscribes to Orders' Event and publishes an Event nothing subscribes to. */
export const billingContract = defineService({
  name: 'billing-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [invoiceIssuedV1],
      subscriptions: [invoiceOnCreated],
    }),
  ],
});

const billingReaders = readersOf({
  commands: {},
  subscriptions: { invoiceOnCreated: { declaration: invoiceOnCreated, reader: orderBody } },
});

const orderAuditedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderAuditedV1,
});

const auditOnCreated = defineSubscription({
  name: 'auditOnCreated',
  description: 'Audit on created',
  event: orderAuditedV1,
});

/** A Service that publishes an Event and has two Subscriptions to it. */
export const auditingContract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderAuditedV1],
      subscriptions: [notifyOnCreated, auditOnCreated],
    }),
  ],
});

const auditingReaders = readersOf({
  commands: {},
  subscriptions: {
    notifyOnCreated: { declaration: notifyOnCreated, reader: orderBody },
    auditOnCreated: { declaration: auditOnCreated, reader: orderBody },
  },
});

/** The Handler map of the auditing Service, each Handler recording what it receives under its name. */
export function auditingHandlersOf(received: Received[]) {
  const recording =
    (handler: string) =>
    (body: unknown, meta: MessageMeta): undefined => {
      received.push({ handler, body, meta });
    };
  return {
    commands: {},
    subscriptions: {
      notifyOnCreated: handle(
        auditingReaders.subscriptions.notifyOnCreated,
        recording('notifyOnCreated'),
      ),
      auditOnCreated: handle(
        auditingReaders.subscriptions.auditOnCreated,
        recording('auditOnCreated'),
      ),
    },
    readers: auditingReaders,
  };
}

/** The Durable consumer of billing's Subscription, as the Broker plan names it. */
export const invoiceDurable = 'billing-service_invoice-on-created';

/** The Handler map of billing, its Handler recording what it receives. */
export function billingHandlersOf(received: Received[]) {
  const record = (body: unknown, meta: MessageMeta): undefined => {
    received.push({ handler: 'invoiceOnCreated', body, meta });
  };
  return {
    commands: {},
    subscriptions: {
      invoiceOnCreated: handle(billingReaders.subscriptions.invoiceOnCreated, record),
    },
    readers: billingReaders,
  };
}

/** The limits most tests use: a 30 s wait and at most three deliveries. */
export const thirtySeconds = {
  durableConsumerDefaults: { ackWait: '30s', maxDeliver: 3 },
} as const satisfies InProcessBrokerLimits;

/** A messaging of `contract` over `broker`, closed when the test ends. */
export async function aMessagingOver<const C extends ServiceContract>(
  contract: C,
  broker: Broker,
  options: MessagingOptions = {},
) {
  const started = await messaging(contract, broker, options);
  onTestFinished(() => started.close().catch(() => undefined));
  return started;
}
