import { defineCommand, defineContract, defineEvent, defineSubscription } from '@cf-loom/contract';
import { handle, withReader } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  type BrokerConsumer,
  type Messaging,
  messaging,
  type OutgoingMessage,
} from './index.ts';

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

const notifyOnCreated = defineSubscription({ name: 'notify-on-created', event: orderCreatedV2 });

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
  subscriptions: [notifyOnCreated],
});

/** The Service's own `src/messaging.ts`, as the README's Connecting writes it. */
let started: Messaging<typeof contract> | undefined;

async function startMessaging(broker: Broker): Promise<Messaging<typeof contract>> {
  started = await messaging(contract, broker);
  return started;
}

function ordersMessaging(): Messaging<typeof contract> {
  if (started === undefined) {
    throw new Error('startMessaging() was not called');
  }
  return started;
}

/** A broker that records what is published and the consumers it is given, built on the public `Broker` type. */
function aBroker() {
  const published: OutgoingMessage[] = [];
  const consumers: BrokerConsumer[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async (message) => {
        published.push(message);
      },
      consume: async (given) => {
        consumers.push(...given);
      },
      close: async () => undefined,
    }),
  };
  return { broker, published, consumers };
}

describe('the messaging README', () => {
  test('the Connecting and Publishing examples run against a broker', async () => {
    const { broker, published } = aBroker();
    const orderId = 'o-1';
    const total = { amount: 12, currency: 'EUR' };
    const order = { id: orderId };
    const traceparent = '00-abc-def-01';
    const v1 = { orderId, total: total.amount };
    const v2 = { orderId, total };
    await startMessaging(broker);

    await ordersMessaging().publisher.publish('OrderCreated', {
      v1: { orderId, total: total.amount },
      v2: { orderId, total },
    });
    await ordersMessaging().sender.send('ChargeCard', { orderId });
    await ordersMessaging().publisher.publish(
      'OrderCreated',
      { v1, v2 },
      { factId: `${order.id}:created`, headers: { traceparent } },
    );
    await ordersMessaging().close();

    expect(published.map((message) => message.messageId).slice(3)).toEqual([
      'OrderCreated.v1:o-1:created',
      'OrderCreated.v2:o-1:created',
    ]);
    expect(published[4]?.headers).toEqual({ traceparent });
  });

  test('the Message Handlers example runs through consume, reading its meta', async () => {
    const { broker, consumers } = aBroker();
    const received: unknown[] = [];
    const notifyOnCreatedHandler = handle(
      withReader(notifyOnCreated, orderCreatedV2.body),
      async (body, { messageId, factId, deliveryCount, headers }) => {
        received.push(body.orderId, { messageId, factId, deliveryCount, headers });
      },
    );
    const running = await startMessaging(broker);
    await running.consume({
      commands: { chargeCardV1: handle(withReader(chargeCardV1, chargeCardV1.body), () => {}) },
      subscriptions: { 'notify-on-created': notifyOnCreatedHandler },
    });
    const meta = {
      messageId: 'OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      deliveryCount: 2,
      headers: { traceparent: '00-abc-def-01' },
    };
    const body = { orderId: 'o-1', total: { amount: 12, currency: 'EUR' } };
    const consumer = consumers.find((candidate) => candidate.element === notifyOnCreated);

    const settlement = await consumer?.receive({
      ...meta,
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    await running.close();

    expect(settlement).toEqual({ kind: 'acked' });
    expect(received).toEqual(['o-1', meta]);
  });
});
