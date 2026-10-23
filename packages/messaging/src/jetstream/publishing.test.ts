import { defineCommand, defineContract, defineEvent } from '@cf-loom/contract';
import { jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { z } from 'zod';
import { withMethods } from '../../test/connections.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, dropStream } from '../../test/streams.ts';
import { messaging, PublishError } from '../index.ts';
import { jetstream } from './index.ts';

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created',
  body: z.object({ orderId: z.string() }),
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created, with its total',
  body: z.object({ orderId: z.string(), total: z.number() }),
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
  return `t-${tests}`;
}

/** Opens a connection to the test server, closed when the test ends. */
async function aConnection(): Promise<NatsConnection> {
  const connection = await connect({ servers: server.url });
  onTestFinished(() => connection.close());
  return connection;
}

/**
 * The Service’s `connect`, over a connection that records the requests its NATS client sends and
 * fails them all with the error given from `refuse` on, as a NATS client fails when the Broker
 * refuses a Message.
 */
function aWatchedConnect() {
  let refusal: unknown;
  const requests: { readonly subject: string; readonly timeout: number | undefined }[] = [];
  const watched = async (): Promise<NatsConnection> => {
    const connection = await aConnection();
    const request: NatsConnection['request'] = (subject, payload, options) => {
      requests.push({ subject, timeout: options?.timeout });
      if (refusal !== undefined) {
        return Promise.reject(refusal);
      }
      return connection.request(subject, payload, options);
    };
    return withMethods(connection, { request });
  };
  return {
    connect: watched,
    requests,
    refuse: (error: unknown) => {
      refusal = error;
    },
  };
}

/** A messaging() whose stream the Service’s broker plan describes, under a prefix of its own. */
async function aMessaging() {
  const prefix = aPrefix();
  await arrangePlanOf(server.url, contract, prefix);
  const opened: NatsConnection[] = [];
  const connectService = async () => {
    const connection = await aConnection();
    opened.push(connection);
    return connection;
  };
  const started = await messaging(contract, jetstream({ connect: connectService, prefix }));
  return { ...started, prefix, stream: `${prefix}_orders-service`, opened };
}

/** What a stream stores last on a subject: its body text and every header. */
async function storedOn(stream: string, subject: string) {
  const manager = await jetstreamManager(await aConnection());
  // biome-ignore lint/style/useNamingConvention: nats.js spells the request `last_by_subj`
  const stored = await manager.streams.getMessage(stream, { last_by_subj: subject });
  const headers = Object.fromEntries(
    (stored?.header.keys() ?? []).map((name) => [name, stored?.header.get(name)]),
  );
  return { body: new TextDecoder().decode(stored?.data), headers };
}

async function messagesIn(stream: string): Promise<number> {
  const manager = await jetstreamManager(await aConnection());
  return (await manager.streams.info(stream)).state.messages;
}

async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('publishing over jetstream()', () => {
  test('publish stores each version’s body bytes on its prefixed subject, with Nats-Msg-Id, Cf-Loom-Fact-Id and the transport headers', async () => {
    const { publisher, prefix, stream } = await aMessaging();

    await publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } },
      { factId: 'o-1:created', headers: { traceparent: '00-abc-def-01' } },
    );

    const subject = (version: number) => `${prefix}.orders-service.event.OrderCreated.v${version}`;
    await expect(storedOn(stream, subject(1))).resolves.toEqual({
      body: '{"orderId":"o-1"}',
      headers: {
        'Nats-Msg-Id': 'OrderCreated.v1:o-1:created',
        'Cf-Loom-Fact-Id': 'o-1:created',
        traceparent: '00-abc-def-01',
      },
    });
    await expect(storedOn(stream, subject(2))).resolves.toEqual({
      body: '{"orderId":"o-1","total":12}',
      headers: {
        'Nats-Msg-Id': 'OrderCreated.v2:o-1:created',
        'Cf-Loom-Fact-Id': 'o-1:created',
        traceparent: '00-abc-def-01',
      },
    });
  });

  test('send stores the Command’s body on its prefixed subject with its broker message id', async () => {
    const { sender, prefix, stream } = await aMessaging();

    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'o-1:charge' });

    await expect(
      storedOn(stream, `${prefix}.orders-service.command.ChargeCard.v1`),
    ).resolves.toEqual({
      body: '{"orderId":"o-1"}',
      headers: { 'Nats-Msg-Id': 'ChargeCard.v1:o-1:charge', 'Cf-Loom-Fact-Id': 'o-1:charge' },
    });
  });

  test('publishing the same fact again resolves, and the stream keeps one Message per version', async () => {
    const { publisher, stream } = await aMessaging();
    const bodies = { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } };
    await publisher.publish('OrderCreated', bodies, { factId: 'o-1:created' });

    const again = publisher.publish('OrderCreated', bodies, { factId: 'o-1:created' });

    await expect(again).resolves.toBeUndefined();
    await expect(messagesIn(stream)).resolves.toBe(2);
  });

  test('a publish the NATS client rejects rejects with a PublishError whose cause is that very error', async () => {
    const refusing = aWatchedConnect();
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const { publisher } = await messaging(
      contract,
      jetstream({ connect: refusing.connect, prefix }),
    );
    const refusal = new Error('the Broker refused it');
    refusing.refuse(refusal);

    const error = await rejectionOf(
      publisher.publish('OrderCreated', {
        v1: { orderId: 'o-1' },
        v2: { orderId: 'o-1', total: 1 },
      }),
    );

    expect(error).toBeInstanceOf(PublishError);
    expect((error as PublishError).cause).toBe(refusal);
  });

  test('a publish to a stream that no longer exists rejects with a PublishError, sending nothing', async () => {
    const { publisher, stream } = await aMessaging();
    await dropStream(server.url, stream);

    const error = await rejectionOf(
      publisher.publish('OrderCreated', {
        v1: { orderId: 'o-1' },
        v2: { orderId: 'o-1', total: 1 },
      }),
    );

    expect(error).toBeInstanceOf(PublishError);
    expect((error as PublishError).sent).toEqual([]);
  });

  test('a send the NATS client rejects rejects with that very error', async () => {
    const refusing = aWatchedConnect();
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const { sender } = await messaging(contract, jetstream({ connect: refusing.connect, prefix }));
    const refusal = new Error('the Broker refused it');
    refusing.refuse(refusal);

    const sending = sender.send('ChargeCard', { orderId: 'o-1' });

    await expect(sending).rejects.toBe(refusal);
  });

  test('close closes the connection the Service’s connect returned', async () => {
    const { close, opened } = await aMessaging();

    await close();

    expect(opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('close resolves when the Service’s connection is already closed', async () => {
    const { close, opened } = await aMessaging();
    await opened[0]?.close();

    const closing = close();

    await expect(closing).resolves.toBeUndefined();
  });

  test('close resolves when the Service is already draining its connection', async () => {
    const { close, opened } = await aMessaging();
    const draining = opened[0]?.drain();

    const closing = close();

    await expect(closing).resolves.toBeUndefined();
    await draining;
    expect(opened[0]?.isClosed()).toBe(true);
  });

  test('the jetstream options reach the publishing client: the configured timeout is the one a publish waits for the acknowledgement with', async () => {
    const watching = aWatchedConnect();
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const { sender } = await messaging(
      contract,
      jetstream({ connect: watching.connect, prefix, jetstream: { timeout: 1234 } }),
    );

    await sender.send('ChargeCard', { orderId: 'o-1' });

    const subject = `${prefix}.orders-service.command.ChargeCard.v1`;
    const published = watching.requests.filter((request) => request.subject === subject);
    expect(published.map((request) => request.timeout)).toEqual([1234]);
  });
});
