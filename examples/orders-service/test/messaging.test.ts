import { randomUUID } from 'node:crypto';
import { type Messaging, messaging } from '@cf-loom/messaging';
import { type MemoryBroker, memory } from '@cf-loom/messaging/memory';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { chargesOf } from '../src/charges/charges.ts';
import { chargeCardV1 } from '../src/contract/commands/orders/charge-card.v1.command.ts';
import { orderCreatedV1 } from '../src/contract/events/orders/order-created.v1.event.ts';
import { contract } from '../src/contract/index.ts';
import createOrderHandler from '../src/endpoints/orders/create-order.handler.ts';
import handlers from '../src/handlers.generated.ts';
import type { Resources } from '../src/resources.ts';

const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const total = { amount: 1500, currency: 'EUR' };
const context = { apiKey: { callerId: 'billing-service' } };
let broker: MemoryBroker;
let running: Messaging<typeof contract>;
let resources: Resources;

beforeEach(async () => {
  broker = memory();
  running = await messaging(contract, broker);
  resources = { publisher: running.publisher, sender: running.sender };
  await running.consume(handlers, { resources });
});

afterEach(async () => {
  await running.close();
});

/** Places an order and waits for the Messages it set going, returning the new order's id. */
async function placeOrder(): Promise<string> {
  const input = { body: { customerId: CUSTOMER_ID, total } };
  const outcome = await createOrderHandler(input, { context }, { resources });
  await broker.settled();
  if (outcome.kind !== 'success') throw new Error('the order was not placed');
  return outcome.body.id;
}

function messagesOn(subject: string) {
  return broker.messages.filter((message) => message.subject === subject);
}

describe('orders-service over the memory adapter', () => {
  test('a placed order publishes OrderCreated@1 with its id, customer and total under the Fact id <order id>:created', async () => {
    const orderId = await placeOrder();

    const published = messagesOn('orders-service.event.OrderCreated.v1');

    expect(published).toMatchObject([
      {
        factId: `${orderId}:created`,
        body: { orderId, customerId: CUSTOMER_ID, total },
      },
    ]);
  });

  test('OrderCreated reaches chargeOnCreated, which sends ChargeCard@1 under the Fact id <order id>:charge', async () => {
    const orderId = await placeOrder();

    const sent = messagesOn('orders-service.command.ChargeCard.v1');

    expect(sent).toMatchObject([{ factId: `${orderId}:charge`, body: { orderId, total } }]);
  });

  test('ChargeCard’s CommandHandler charges the order’s total', async () => {
    const orderId = await placeOrder();

    const charges = chargesOf(orderId);

    expect(charges).toEqual([{ orderId, total }]);
  });

  test('OrderCreated delivered again sends ChargeCard under the same Fact id, so the order is charged once', async () => {
    const orderId = await placeOrder();
    const body = { orderId, customerId: CUSTOMER_ID, total };

    const settlement = await broker.deliver(orderCreatedV1, body, { factId: `${orderId}:created` });
    await broker.settled();

    expect(settlement).toBe('acked');
    expect(messagesOn('orders-service.command.ChargeCard.v1')).toHaveLength(1);
    expect(chargesOf(orderId)).toEqual([{ orderId, total }]);
  });

  test('ChargeCard delivered twice charges the order once', async () => {
    const orderId = randomUUID();
    const body = { orderId, total };

    const first = await broker.deliver(chargeCardV1, body, { factId: `${orderId}:charge` });
    const second = await broker.deliver(chargeCardV1, body, { factId: `${orderId}:charge` });

    expect([first, second]).toEqual(['acked', 'acked']);
    expect(chargesOf(orderId)).toEqual([{ orderId, total }]);
  });
});
