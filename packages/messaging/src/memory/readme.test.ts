import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependency,
  defineEvent,
  defineGroup,
  defineSubscription,
} from '@cf-loom/contract';
import { handle, readersOf, type WithResources } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { providedStandardRejections } from '../../test/standard-rejections.ts';
import { type CommandSender, type EventPublisher, messaging } from '../index.ts';
import { memory } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const PAYMENT_ID = '0b5e1c9a-52f7-4c63-9a0e-3d8f2b7a1c44';

const money = z.object({ amount: z.number(), currency: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created, with its currency',
  body: z.object({ orderId: z.uuid(), total: money }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: {},
  events: { paymentSettledV1 },
  standardRejections: providedStandardRejections(),
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDependency = defineDependency({ provider: payments });

const chargeOnCreated = defineSubscription({
  name: 'chargeOnCreated',
  description: 'Charge on created',
  event: orderCreatedV2,
});

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notify on settled',
  event: paymentSettledV1,
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, orderCreatedV2],
      commands: [chargeCardV1],
      subscriptions: [chargeOnCreated, notifyOnSettled],
    }),
  ],
  dependencies: [paymentsDependency],
});

type Resources = {
  readonly publisher: EventPublisher<typeof contract>;
  readonly sender: CommandSender<typeof contract>;
};
type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

const charged: string[] = [];

const notified: string[] = [];

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {
    chargeOnCreated: { element: chargeOnCreated, reader: orderCreatedV2.body },
    notifyOnSettled: { element: notifyOnSettled, reader: paymentSettledV1.body },
  },
});

const handlers = {
  commands: {
    chargeCardV1: handle(readers.commands.chargeCardV1, ({ orderId }) => {
      charged.push(orderId);
    }),
  },
  subscriptions: {
    chargeOnCreated: handle(
      readers.subscriptions.chargeOnCreated,
      async ({ orderId }, meta, { resources: { sender } }: Needs<'sender'>) => {
        await sender.send('ChargeCard', { orderId }, { factId: `${meta.factId}:charge` });
      },
    ),
    notifyOnSettled: handle(readers.subscriptions.notifyOnSettled, ({ paymentId }) => {
      notified.push(paymentId);
    }),
  },
  readers,
};

/** An Endpoint Handler of the Service, which publishes the Event of the order it created. */
async function createOrderHandler(
  request: { readonly body: { readonly total: number } },
  { resources: { publisher } }: Needs<'publisher'>,
) {
  const total = { amount: request.body.total, currency: 'EUR' };
  await publisher.publish(
    'OrderCreated',
    {
      v1: { orderId: ORDER_ID, total: total.amount },
      v2: { orderId: ORDER_ID, total },
    },
    { factId: `${ORDER_ID}:created` },
  );
}

describe('the In memory section of the messaging README', () => {
  test('the example runs: a Handler publishes and sends, settled() waits for the chain, messages lists them, and deliver resolves acked', async () => {
    const broker = memory();
    const running = await messaging(contract, broker);
    const resources = { publisher: running.publisher, sender: running.sender };
    await running.consume(handlers, { resources });

    await createOrderHandler({ body: { total: 12 } }, { resources });
    await broker.settled();
    const messages = broker.messages.map(({ subject }) => subject);
    const settlement = await broker.deliver(
      payments.events.paymentSettledV1,
      { paymentId: PAYMENT_ID },
      { factId: 'pay-1' },
    );
    await running.close();

    expect(messages).toEqual([
      'orders-service.event.OrderCreated.v1',
      'orders-service.event.OrderCreated.v2',
      'orders-service.command.ChargeCard.v1',
    ]);
    expect(charged).toEqual([ORDER_ID]);
    expect(settlement).toBe('acked');
    expect(notified).toEqual([PAYMENT_ID]);
  });
});
