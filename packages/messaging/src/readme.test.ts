import { defineCommand, defineContract, defineEvent } from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Broker, messaging, type OutgoingMessage } from './index.ts';

const money = z.object({ amount: z.number(), currency: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created',
  body: z.object({ orderId: z.string(), total: z.number() }),
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created, with its currency',
  body: z.object({ orderId: z.string(), total: money }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string() }),
});

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
});

/** A broker that records what is published, built on the public `Broker` type. */
function aBroker() {
  const published: OutgoingMessage[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async (message) => {
        published.push(message);
      },
      consume: async () => undefined,
      close: async () => undefined,
    }),
  };
  return { broker, published };
}

describe('the messaging README', () => {
  test('the Connecting and Publishing examples run against a broker', async () => {
    const { broker, published } = aBroker();
    const { publisher, sender, connect, close } = messaging(contract);
    const orderId = 'o-1';
    const total = { amount: 12, currency: 'EUR' };
    const order = { id: orderId };
    const traceparent = '00-abc-def-01';
    const v1 = { orderId, total: total.amount };
    const v2 = { orderId, total };
    await connect(broker);

    await publisher.publish('OrderCreated', {
      v1: { orderId, total: total.amount },
      v2: { orderId, total },
    });
    await sender.send('ChargeCard', { orderId });
    await publisher.publish(
      'OrderCreated',
      { v1, v2 },
      { factId: `${order.id}:created`, headers: { traceparent } },
    );
    await close();

    expect(published.map((message) => message.messageId).slice(3)).toEqual([
      'OrderCreated.v1:o-1:created',
      'OrderCreated.v2:o-1:created',
    ]);
    expect(published[4]?.headers).toEqual({ traceparent });
  });
});
