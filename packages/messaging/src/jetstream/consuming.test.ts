// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import { defineCommand, defineContract, defineEvent, defineSubscription } from '@cf-loom/contract';
import { type Fault, handle, type MessageMeta, withReader } from '@cf-loom/handlers';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { arrangeDurablesOf, durableInfoOf } from '../../test/durables.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, dropStream, planOf } from '../../test/streams.ts';
import { type Messaging, messaging } from '../index.ts';
import { type BrokerPlan, jetstream } from './index.ts';

const orderBody = z.object({ orderId: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

const notifyOnCreated = defineSubscription({ name: 'notify-on-created', event: orderCreatedV1 });

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1],
  commands: [chargeCardV1],
  subscriptions: [notifyOnCreated],
});

let server: NatsServer;
let tests = 0;

beforeAll(async () => {
  server = await aNatsServer();
});

afterAll(async () => {
  await server.stop();
});

/** A prefix no other test of this file uses, so streams on the shared server never collide. */
function aPrefix(): string {
  tests += 1;
  return `c-${tests}`;
}

/** The Service’s own `connect`: opens a connection to the test server and closes it when the test ends. */
function aConnect() {
  const opened: NatsConnection[] = [];
  const connectService = async (): Promise<NatsConnection> => {
    const connection = await connect({ servers: server.url });
    opened.push(connection);
    onTestFinished(() => connection.close());
    return connection;
  };
  return { connect: connectService, opened };
}

/** Orders’ names under a prefix: its stream, its subjects and its two durable consumers. */
function anOrders(prefix: string) {
  return {
    stream: `${prefix}_orders-service`,
    created: `${prefix}.orders-service.event.OrderCreated.v1`,
    charge: `${prefix}.orders-service.command.ChargeCard.v1`,
    notifyDurable: `${prefix}_orders-service_notify-on-created`,
    chargeDurable: `${prefix}_orders-service_command_ChargeCard_v1`,
  };
}

type Received = { readonly handler: string; readonly body: unknown; readonly meta: MessageMeta };

type Behavior = (received: Received) => Promise<Fault | undefined> | Fault | undefined;

/** The Handler map of Orders, each Handler recording what it receives and then doing as the behavior says. */
function handlersOf(
  received: Received[],
  behaviors: { notify?: Behavior; charge?: Behavior } = {},
) {
  const recording = (handler: string, behavior: Behavior | undefined) => {
    return async (body: unknown, meta: MessageMeta): Promise<Fault | undefined> => {
      const entry = { handler, body, meta };
      received.push(entry);
      return await behavior?.(entry);
    };
  };
  return {
    commands: {
      chargeCardV1: handle(
        withReader(chargeCardV1, orderBody),
        recording('ChargeCard@1', behaviors.charge),
      ),
    },
    subscriptions: {
      'notify-on-created': handle(
        withReader(notifyOnCreated, orderBody),
        recording('notify-on-created', behaviors.notify),
      ),
    },
  };
}

/** A messaging over `jetstream()` on the test server, closed when the test ends. */
async function aMessaging(prefix: string): Promise<Messaging<typeof contract>> {
  const broker = jetstream({ connect: aConnect().connect, prefix });
  const opened = await messaging(contract, broker, { onServiceFault: () => undefined });
  onTestFinished(() => opened.close());
  return opened;
}

/** Orders’ streams and durable consumers on the test server, as the organization’s tooling would arrange them. */
async function arrangeOrders(prefix: string): Promise<void> {
  await arrangePlanOf(server.url, contract, prefix);
  await arrangeDurablesOf(server.url, planOf(contract, prefix));
}

/** The plan with only the durable consumers named kept, to arrange some of Orders’ durable consumers and not others. */
function onlyDurablesOf(plan: BrokerPlan, ...names: readonly string[]): BrokerPlan {
  const kept = Object.entries(plan.consumers).filter(([name]) => names.includes(name));
  return { ...plan, consumers: Object.fromEntries(kept) };
}

/** Waits for what a test expects not to happen: the window in which it would have. */
function aWhile(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

const apply = "apply the Service's broker plan";

describe('consuming over jetstream()', () => {
  test('consume binds each Subscription and Command Version to its prefixed durable consumer, and a Message published before or after it reaches its Handler', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.sender.send('ChargeCard', { orderId: 'o-1' });

    await orders.consume(handlersOf(received));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ handler, body }) => ({ handler, body }))).toEqual(
      expect.arrayContaining([
        { handler: 'ChargeCard@1', body: { orderId: 'o-1' } },
        { handler: 'notify-on-created', body: { orderId: 'o-2' } },
      ]),
    );
  });

  test('consume rejects naming each durable consumer that does not exist and the stream it reads, and pulls from none', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    await messagingOfOrders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    const consuming = messagingOfOrders.consume(handlersOf(received));

    await expect(consuming).rejects.toThrow(
      `The durable consumer ${orders.chargeDurable} does not exist on the stream ${orders.stream}: ${apply}`,
    );
    await aWhile();
    const info = await durableInfoOf(server.url, orders.stream, orders.notifyDurable);
    expect(received).toEqual([]);
    expect(info).toMatchObject({ num_pending: 1, num_waiting: 0, delivered: { consumer_seq: 0 } });
  });

  test('consume rejects naming every durable consumer that does not exist', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const messagingOfOrders = await aMessaging(prefix);

    const consuming = messagingOfOrders.consume(handlersOf([]));

    const error = await consuming.catch((rejected: unknown) => rejected);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.split('\n').sort()).toEqual([
      `The durable consumer ${orders.chargeDurable} does not exist on the stream ${orders.stream}: ${apply}`,
      `The durable consumer ${orders.notifyDurable} does not exist on the stream ${orders.stream}: ${apply}`,
    ]);
  });

  test('consume called again once the missing durable consumer exists starts consuming', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    await messagingOfOrders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await messagingOfOrders.sender.send('ChargeCard', { orderId: 'o-2' });
    await messagingOfOrders.consume(handlersOf(received)).catch(() => undefined);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.chargeDurable));

    await messagingOfOrders.consume(handlersOf(received));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ handler }) => handler).sort()).toEqual([
      'ChargeCard@1',
      'notify-on-created',
    ]);
  });

  test('consume rejects naming the stream when the stream a durable consumer reads does not exist', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrders(prefix);
    const messagingOfOrders = await aMessaging(prefix);
    await dropStream(server.url, orders.stream);

    const consuming = messagingOfOrders.consume(handlersOf([]));

    await expect(consuming).rejects.toThrow(
      `The stream ${orders.stream}, which the durable consumer ${orders.notifyDurable} reads, does not exist: ${apply}`,
    );
  });
});
