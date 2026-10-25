import { defineContract, defineEvent, defineGroup, defineSubscription } from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import type { ConnectionOptions, NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { stopServerUnder, withMethods } from '../../test/connections.ts';
import { arrangeDurablesOf, durableInfoOf } from '../../test/durables.ts';
import { aHoldingProxy } from '../../test/holding-proxy.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, planOf } from '../../test/streams.ts';
import { CloseAbortedError, messaging } from '../index.ts';
import { jetstream } from './index.ts';

const orderBody = z.object({ orderId: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const readers = readersOf({
  commands: {},
  subscriptions: { notifyOnCreated: { element: notifyOnCreated, reader: orderBody } },
});

const prefix = 'c';
const unanswered = 'NATS did not answer the drain, so the connection was closed without it';

/** A nats-server this test starts and stops itself, so a test can stop it, and stopped when the test ends. */
async function anOwnServer(): Promise<NatsServer> {
  const server = await aNatsServer();
  onTestFinished(() => server.stop());
  return server;
}

type Settings = {
  /** Where the Service’s connect opens its connection: the server itself unless a test puts a proxy in front. */
  readonly servers?: string;
  readonly nats?: Partial<ConnectionOptions>;
  /** The methods of the connection the Service’s connect returns that the test replaces. */
  readonly replacing?: (connection: NatsConnection) => Partial<NatsConnection>;
  /** The Handler of the one Subscription, which makes the messaging consume. */
  readonly consuming?: (() => Promise<undefined>) | undefined;
};

/** A messaging over `jetstream()` on a server of the test’s own, with the one connection the Service’s connect opened; it never closes the messaging, since the test closes it. */
async function aMessaging(server: NatsServer, settings: Settings = {}) {
  await arrangePlanOf(server.url, contract, prefix);
  await arrangeDurablesOf(server.url, planOf(contract, prefix));
  const opened: NatsConnection[] = [];
  const connectService = async (): Promise<NatsConnection> => {
    const connection = await connect({
      servers: settings.servers ?? server.url,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 200,
      ...settings.nats,
    });
    opened.push(connection);
    onTestFinished(() => connection.close());
    return settings.replacing === undefined
      ? connection
      : withMethods(connection, settings.replacing(connection));
  };
  const started = await messaging(contract, jetstream({ connect: connectService, prefix }));
  const handler = settings.consuming;
  if (handler !== undefined) {
    await started.consume({
      commands: {},
      subscriptions: { notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, handler) },
      readers,
    });
    await vi.waitFor(async () => {
      const durable = `${prefix}_orders-service_notify-on-created`;
      const info = await durableInfoOf(server.url, `${prefix}_orders-service`, durable);
      expect(info?.num_waiting).toBe(1);
    });
  }
  return { ...started, connection: opened[0] as NatsConnection };
}

/** An Error a call rejected with, or undefined when it resolved. */
async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A Handler that never settles, so a delivery stays in flight until the messaging hands it back. */
const neverSettling = () => new Promise<undefined>(() => undefined);

describe('close over jetstream() when NATS does not answer the drain', () => {
  test.each([
    ['while it was consuming', neverSettling],
    ['when nothing was consumed', undefined],
  ])(
    'close, when the server stopped %s, closes the connection and rejects saying NATS did not answer the drain, with NATS’s error as its cause',
    async (_when, consuming) => {
      const server = await anOwnServer();
      const { close, connection } = await aMessaging(server, { consuming });
      await stopServerUnder(connection, server);

      const error = await rejectionOf(close());

      expect(error).toMatchObject({ message: unanswered, cause: expect.any(Error) });
      expect(connection.isClosed()).toBe(true);
    },
  );

  test('close, when the Service’s own drain was not answered, closes the connection and rejects the same way', async () => {
    const server = await anOwnServer();
    const { close, connection } = await aMessaging(server);
    await stopServerUnder(connection, server);
    await rejectionOf(connection.drain());

    const error = await rejectionOf(close());

    expect(error).toMatchObject({ message: unanswered, cause: expect.any(Error) });
    expect(connection.isClosed()).toBe(true);
  });

  test('close resolves when the Service’s drain closes the connection before NATS answers close’s own flush', async () => {
    const server = await anOwnServer();
    const neverAnswered = () => ({ flush: () => new Promise<void>(() => undefined) });
    const { close, connection } = await aMessaging(server, { replacing: neverAnswered });
    const draining = connection.drain();

    const closing = close();

    await expect(closing).resolves.toBeUndefined();
    await draining;
    expect(connection.isClosed()).toBe(true);
  });

  test('close resolves when the Service closes its connection while close is draining it', async () => {
    const server = await anOwnServer();
    const proxy = await aHoldingProxy(server.url);
    onTestFinished(() => proxy.stop());
    const { close, connection } = await aMessaging(server, { servers: proxy.url });
    proxy.hold();
    const closing = close();
    await vi.waitFor(() => expect(connection.isDraining()).toBe(true));

    await connection.close();

    await expect(closing).resolves.toBeUndefined();
  });

  test('close resolves when the Service closes its connection while it drains it and NATS has not answered yet', async () => {
    const server = await anOwnServer();
    const proxy = await aHoldingProxy(server.url);
    onTestFinished(() => proxy.stop());
    const asked = Promise.withResolvers<undefined>();
    const signalingFlush = (raw: NatsConnection) => ({
      flush: () => {
        asked.resolve(undefined);
        return raw.flush();
      },
    });
    const { close, connection } = await aMessaging(server, {
      servers: proxy.url,
      replacing: signalingFlush,
    });
    proxy.hold();
    connection.drain().catch(() => undefined);
    const closing = close();
    await asked.promise;

    await connection.close();

    await expect(closing).resolves.toBeUndefined();
  });

  test.each([
    ['NATS answers and cf-loom drains', { stopped: false, serviceDrains: false }, undefined],
    [
      'NATS answers and the Service drained first',
      { stopped: false, serviceDrains: true },
      undefined,
    ],
    ['the server stopped and cf-loom drains', { stopped: true, serviceDrains: false }, unanswered],
    [
      'the server stopped and the Service drained first',
      { stopped: true, serviceDrains: true },
      unanswered,
    ],
  ])(
    'close ends with the connection closed when %s',
    async (_case, { stopped, serviceDrains }, expected) => {
      const server = await anOwnServer();
      const { close, connection } = await aMessaging(server);
      if (stopped) {
        await stopServerUnder(connection, server);
      }
      const drained = serviceDrains ? rejectionOf(connection.drain()) : undefined;
      if (stopped) {
        await drained;
      }

      const error = await rejectionOf(close());

      expect((error as Error | undefined)?.message).toBe(expected);
      expect(connection.isClosed()).toBe(true);
    },
  );

  test('close({ signal }) that handed a delivery back, when the server is gone, closes the connection and rejects with the drain’s error, not CloseAbortedError', async () => {
    const server = await anOwnServer();
    const started = vi.fn();
    const handler = () => {
      started();
      return neverSettling();
    };
    const { close, connection, publisher } = await aMessaging(server, { consuming: handler });
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-275' });
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    await stopServerUnder(connection, server);

    const error = await rejectionOf(close({ signal: AbortSignal.abort() }));

    expect(error).toMatchObject({ message: unanswered, cause: expect.any(Error) });
    expect(error).not.toBeInstanceOf(CloseAbortedError);
    expect(connection.isClosed()).toBe(true);
  });

  test('close, when NATS is silent and the Service’s connect sets pingInterval, maxPingOut and timeout, rejects within them with the connection closed', async () => {
    const server = await anOwnServer();
    const proxy = await aHoldingProxy(server.url);
    onTestFinished(() => proxy.stop());
    const nats = { pingInterval: 500, maxPingOut: 2, timeout: 2_000 };
    const { close, connection } = await aMessaging(server, { servers: proxy.url, nats });
    proxy.hold();

    const error = await rejectionOf(close());

    expect(error).toMatchObject({ message: unanswered, cause: expect.any(Error) });
    expect(connection.isClosed()).toBe(true);
  }, 10_000);
});
