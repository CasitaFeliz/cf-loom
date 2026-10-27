import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
} from '@cf-loom/contract';
import { handle, readersOf, type WithResources } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Broker, type DurableConsumer, messaging, type OutgoingMessage } from './index.ts';

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

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV2,
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, orderCreatedV2],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

type Resources = { readonly notifications: { readonly send: (orderId: string) => Promise<void> } };
type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

/** A broker that records what is published and the Durable consumers it is given, built on the public `Broker` type. */
function aBroker() {
  const published: OutgoingMessage[] = [];
  const durableConsumers: DurableConsumer[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async (message) => {
        published.push(message);
        return { duplicate: false };
      },
      consume: async (given) => {
        durableConsumers.push(...given);
      },
      close: async () => undefined,
    }),
  };
  return { broker, published, durableConsumers };
}

describe('the messaging README', () => {
  test('the Connecting and Publishing examples run against a broker', async () => {
    const { broker, published } = aBroker();
    const orderId = 'o-1';
    const total = { amount: 12, currency: 'EUR' };
    const order = { id: orderId };
    const traceparent = '00-abc-def-01';
    const headers: Readonly<Record<string, string>> = { traceparent };
    const meta = { factId: 'o-1:created', headers };
    const { publisher, sender, close } = await messaging(contract, broker);

    const { duplicates } = await publisher.publish(
      'OrderCreated',
      { v1: { orderId, total: total.amount }, v2: { orderId, total } },
      { factId: `${order.id}:created` },
    );
    await sender.send(
      'ChargeCard',
      { orderId },
      { factId: `${meta.factId}:charge`, headers: { traceparent: meta.headers['traceparent'] } },
    );
    await close();

    expect(duplicates).toEqual([]);
    expect(published.map((message) => message.messageId)).toEqual([
      'event.OrderCreated.v2:o-1:created',
      'event.OrderCreated.v1:o-1:created',
      'command.ChargeCard.v1:o-1:created:charge',
    ]);
    expect(published[2]?.headers).toEqual({ traceparent });
  });

  test('the Message Handlers example runs through consume, reading its meta', async () => {
    const { broker, durableConsumers } = aBroker();
    const received: unknown[] = [];
    const resources: Resources = {
      notifications: { send: async (orderId) => void received.push(orderId) },
    };
    const readers = readersOf({
      commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
      subscriptions: {
        notifyOnCreated: { declaration: notifyOnCreated, reader: orderCreatedV2.body },
      },
    });
    const notifyOnCreatedHandler = handle(
      readers.subscriptions.notifyOnCreated,
      async (
        body,
        { messageId, factId, deliveryCount, headers },
        { resources: { notifications } }: Needs<'notifications'>,
      ) => {
        await notifications.send(body.orderId);
        received.push({ messageId, factId, deliveryCount, headers });
      },
    );
    const running = await messaging(contract, broker);
    await running.consume(
      {
        commands: { chargeCardV1: handle(readers.commands.chargeCardV1, () => {}) },
        subscriptions: { notifyOnCreated: notifyOnCreatedHandler },
        readers,
      },
      { resources },
    );
    const meta = {
      messageId: 'event.OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      deliveryCount: 2,
      headers: { traceparent: '00-abc-def-01' },
    };
    const body = { orderId: 'o-1', total: { amount: 12, currency: 'EUR' } };
    const durableConsumer = durableConsumers.find(
      (candidate) => candidate.durable === 'orders-service_notify-on-created',
    );

    const settlement = await durableConsumer?.receive({
      ...meta,
      lastAttempt: false,
      waitMs: undefined,
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    await running.close();

    expect(settlement).toBe('acked');
    expect(received).toEqual(['o-1', meta]);
  });
});
