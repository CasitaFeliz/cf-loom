import {
  defineCommand,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  providedEvent,
} from '@cf-loom/contract';
import { handle, readersOf, success, type WithResources } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { CommandSender, EventPublisher } from '../index.ts';
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

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is missing or unknown',
  headers: z.object({ 'www-authenticate': z.string() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string().optional() }) },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Places a pending order',
  guards: [apiKey],
  input: { body: z.object({ total: z.number() }) },
  success: { status: 201, body: z.object({ id: z.uuid(), callerId: z.string() }) },
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

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

const contract = defineService({
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
});

type Resources = {
  readonly publisher: EventPublisher<typeof contract>;
  readonly sender: CommandSender<typeof contract>;
};
type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

const charged: string[] = [];

const notified: string[] = [];

const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {
    chargeOnCreated: { declaration: chargeOnCreated, reader: orderCreatedV2.body },
    notifyOnSettled: { declaration: notifyOnSettled, reader: paymentSettledV1.body },
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

/** The Endpoint Handler of the Service, which publishes the Event of the order it created. */
const createOrderHandler = handle(
  createOrder,
  async ({ body }, { context }, { resources: { publisher } }: Needs<'publisher'>) => {
    const total = { amount: body.total, currency: 'EUR' };
    await publisher.publish(
      'OrderCreated',
      {
        v1: { orderId: ORDER_ID, total: total.amount },
        v2: { orderId: ORDER_ID, total },
      },
      { factId: `${ORDER_ID}:created` },
    );
    return success({ id: ORDER_ID, callerId: context.apiKey.callerId });
  },
);

describe('the In memory section of the messaging README', () => {
  test('the direct call of createOrderHandler passes the apiKey Context, which the Handler reads', async () => {
    const running = await memory(contract);
    const resources = { publisher: running.publisher, sender: running.sender };

    const outcome = await createOrderHandler(
      { body: { total: 12 } },
      { context: { apiKey: { callerId: 'c-7' } } },
      { resources },
    );
    await running.close();

    expect(outcome).toMatchObject({ kind: 'success', body: { callerId: 'c-7' } });
  });

  test('the example runs: a Handler publishes and sends, settled() waits for the chain, messages and messagesOf list them, and deliver resolves acked', async () => {
    const running = await memory(contract);
    const resources = { publisher: running.publisher, sender: running.sender };
    await running.consume(handlers, { resources });

    const created = await createOrderHandler(
      { body: { total: 12 } },
      { context: { apiKey: { callerId: 'c-1' } } },
      { resources },
    );
    await running.settled();
    const messages = running.messages.map(({ subject }) => subject);
    const createdV1 = running.messagesOf(orderCreatedV1).map(({ subject }) => subject);
    const settlement = await running.deliver(
      paymentSettledV1,
      { paymentId: PAYMENT_ID },
      { factId: 'pay-1' },
    );
    await running.close();

    expect(messages).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service.event.OrderCreated.v1',
      'orders-service.command.ChargeCard.v1',
    ]);
    expect(createdV1).toEqual(['orders-service.event.OrderCreated.v1']);
    expect(created).toEqual({
      kind: 'success',
      status: 201,
      body: { id: ORDER_ID, callerId: 'c-1' },
    });
    expect(charged).toEqual([ORDER_ID]);
    expect(settlement).toBe('acked');
    expect(notified).toEqual([PAYMENT_ID]);
  });
});
