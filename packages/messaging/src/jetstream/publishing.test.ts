import { defineCommand, defineEvent, defineGroup, defineService } from '@cf-loom/contract';
import { jetstream as jetStreamClientOf, jetstreamManager } from '@nats-io/jetstream';
import { headers, type NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { z } from 'zod';
import { withMethods } from '../../test/connections.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, arrangeStream, dropStream } from '../../test/streams.ts';
import { InvalidMessageError, MessageNotSentError, messaging } from '../index.ts';
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

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, orderCreatedV2],
      commands: [chargeCardV1],
    }),
  ],
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

/** Publishes a Message the way a publisher other than cf-loom would: exactly these headers, over a connection of its own. */
async function publishRaw(
  subject: string,
  body: unknown,
  entries: readonly (readonly [string, string])[],
): Promise<void> {
  const connection = await aConnection();
  const raw = headers();
  for (const [name, value] of entries) {
    raw.append(name, value);
  }
  await jetStreamClientOf(connection).publish(subject, JSON.stringify(body), { headers: raw });
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
        'Nats-Msg-Id': 'event.OrderCreated.v1:o-1:created',
        'Cf-Loom-Fact-Id': 'o-1:created',
        traceparent: '00-abc-def-01',
      },
    });
    await expect(storedOn(stream, subject(2))).resolves.toEqual({
      body: '{"orderId":"o-1","total":12}',
      headers: {
        'Nats-Msg-Id': 'event.OrderCreated.v2:o-1:created',
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
      headers: {
        'Nats-Msg-Id': 'command.ChargeCard.v1:o-1:charge',
        'Cf-Loom-Fact-Id': 'o-1:charge',
      },
    });
  });

  test('a publish whose broker headers take exactly the bytes JetStream stores stores each version with its Fact id and transport headers as given', async () => {
    const { publisher, prefix, stream } = await aMessaging();
    const pad = 'p'.repeat(65_452);

    await publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } },
      { factId: 'o-1', headers: { 'x-pad': pad } },
    );

    const stored = (version: number) => {
      return storedOn(stream, `${prefix}.orders-service.event.OrderCreated.v${version}`);
    };
    const expected = (version: number) => ({
      'Nats-Msg-Id': `event.OrderCreated.v${version}:o-1`,
      'Cf-Loom-Fact-Id': 'o-1',
      'x-pad': pad,
    });
    await expect(stored(1)).resolves.toMatchObject({ headers: expected(1) });
    await expect(stored(2)).resolves.toMatchObject({ headers: expected(2) });
  });

  test('a publish with broker headers one byte over rejects with InvalidMessageError, not MessageNotSentError, and the stream stores nothing', async () => {
    const { publisher, stream } = await aMessaging();
    const bodies = { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } };
    const padded = { 'x-pad': 'p'.repeat(65_453) };

    const error = await rejectionOf(
      publisher.publish('OrderCreated', bodies, { factId: 'o-1', headers: padded }),
    );

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({
      message: expect.stringMatching(/^OrderCreated@1: The broker headers would take 65536 bytes/),
    });
    await expect(messagesIn(stream)).resolves.toBe(0);
  });

  test('nats.js publishing the same broker headers itself is stored at 65,535 bytes and refused at 65,536, so the bound is the server’s own', async () => {
    const { prefix, stream } = await aMessaging();
    const subject = `${prefix}.orders-service.event.OrderCreated.v1`;
    const entriesOf = (factId: string, pad: string): [string, string][] => [
      ['Nats-Msg-Id', `OrderCreated.v1:${factId}`],
      ['Cf-Loom-Fact-Id', factId],
      ['x-pad', pad],
    ];

    const atTheBound = await rejectionOf(
      publishRaw(subject, { orderId: 'o-1' }, entriesOf('o-1', 'p'.repeat(65_458))),
    );
    const oneOver = await rejectionOf(
      publishRaw(subject, { orderId: 'o-2' }, entriesOf('o-2', 'p'.repeat(65_459))),
    );

    expect(atTheBound).toBeUndefined();
    expect(oneOver).toMatchObject({
      message: expect.stringContaining('header size exceeds maximum allowed of 64k'),
    });
    await expect(messagesIn(stream)).resolves.toBe(1);
  });

  test('an Event and a Command with one name and version, published and sent with one Fact id, are both stored in the stream', async () => {
    const chargeEvent = defineEvent({
      name: 'Charge',
      version: 1,
      visibility: 'internal',
      description: 'A charge was made',
      body: z.object({ orderId: z.string() }),
    });
    const chargeCommand = defineCommand({
      name: 'Charge',
      version: 1,
      description: 'Makes a charge',
      body: z.object({ orderId: z.string() }),
    });
    const sameName = defineService({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'charges',
          description: 'Charges',
          events: [chargeEvent],
          commands: [chargeCommand],
        }),
      ],
    });
    const prefix = aPrefix();
    const stream = `${prefix}_orders-service`;
    await arrangeStream(server.url, {
      name: stream,
      subjects: [
        `${prefix}.orders-service.event.Charge.v1`,
        `${prefix}.orders-service.command.Charge.v1`,
      ],
    });
    const { publisher, sender } = await messaging(
      sameName,
      jetstream({ connect: aConnection, prefix }),
    );
    const body = { orderId: 'o-1' };

    await publisher.publish('Charge', { v1: body }, { factId: 'o-1' });
    await sender.send('Charge', body, { factId: 'o-1' });

    await expect(messagesIn(stream)).resolves.toBe(2);
    await expect(
      storedOn(stream, `${prefix}.orders-service.event.Charge.v1`),
    ).resolves.toMatchObject({
      headers: { 'Nats-Msg-Id': 'event.Charge.v1:o-1' },
    });
    await expect(
      storedOn(stream, `${prefix}.orders-service.command.Charge.v1`),
    ).resolves.toMatchObject({ headers: { 'Nats-Msg-Id': 'command.Charge.v1:o-1' } });
  });

  test('publishing the same Fact id twice resolves to every version as a duplicate, and the stream keeps one Message per version', async () => {
    const { publisher, stream } = await aMessaging();
    const bodies = { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } };
    const first = await publisher.publish('OrderCreated', bodies, { factId: 'o-1:created' });

    const again = await publisher.publish('OrderCreated', bodies, { factId: 'o-1:created' });

    expect(first).toEqual({ factId: 'o-1:created', duplicates: [] });
    expect(again).toEqual({
      factId: 'o-1:created',
      duplicates: ['OrderCreated@1', 'OrderCreated@2'],
    });
    await expect(messagesIn(stream)).resolves.toBe(2);
  });

  test('sending the same Fact id twice resolves duplicate true', async () => {
    const { sender } = await aMessaging();
    const first = await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'o-1:charge' });

    const again = await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'o-1:charge' });

    expect([first, again]).toEqual([
      { factId: 'o-1:charge', duplicate: false },
      { factId: 'o-1:charge', duplicate: true },
    ]);
  });

  test.each([
    [
      { headers: { 'trace id': 'x' } },
      /^headers\."trace id": The transport header name "trace id" cannot travel over NATS/,
    ],
    [{ factId: 'o-1 ' }, /^factId: A Fact id is a non-empty string /],
    [
      { headers: { 'Nats-Expected-Stream': 'other' } },
      /^headers\.Nats-Expected-Stream: The transport header Nats-Expected-Stream takes a name /,
    ],
  ])(
    'publish with %j rejects with InvalidMessageError, not the NATS client’s error, and the stream stores nothing',
    async (options, message) => {
      const { publisher, stream } = await aMessaging();
      const bodies = { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } };

      const error = await rejectionOf(
        publisher.publish('OrderCreated', bodies, { factId: 'f-120', ...options }),
      );

      expect(error).toBeInstanceOf(InvalidMessageError);
      expect(error).toMatchObject({ message: expect.stringMatching(message) });
      await expect(messagesIn(stream)).resolves.toBe(0);
    },
  );

  test('a publish the NATS client rejects rejects with a MessageNotSentError whose cause is that very error', async () => {
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
      publisher.publish(
        'OrderCreated',
        {
          v1: { orderId: 'o-1' },
          v2: { orderId: 'o-1', total: 1 },
        },
        { factId: 'f-121' },
      ),
    );

    expect(error).toBeInstanceOf(MessageNotSentError);
    expect((error as MessageNotSentError).cause).toBe(refusal);
  });

  test('a publish to a stream that no longer exists rejects with a MessageNotSentError, sending nothing', async () => {
    const { publisher, stream } = await aMessaging();
    await dropStream(server.url, stream);

    const error = await rejectionOf(
      publisher.publish(
        'OrderCreated',
        {
          v1: { orderId: 'o-1' },
          v2: { orderId: 'o-1', total: 1 },
        },
        { factId: 'f-122' },
      ),
    );

    expect(error).toBeInstanceOf(MessageNotSentError);
    expect((error as MessageNotSentError).sent).toEqual([]);
  });

  test('a send the NATS client rejects rejects with a MessageNotSentError whose cause is that very error', async () => {
    const refusing = aWatchedConnect();
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const { sender } = await messaging(contract, jetstream({ connect: refusing.connect, prefix }));
    const refusal = new Error('the Broker refused it');
    refusing.refuse(refusal);

    const error = await rejectionOf(
      sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-123' }),
    );

    expect(error).toBeInstanceOf(MessageNotSentError);
    expect(error).toMatchObject({ factId: 'f-123', sent: [], cause: refusal });
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

    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-124' });

    const subject = `${prefix}.orders-service.command.ChargeCard.v1`;
    const published = watching.requests.filter((request) => request.subject === subject);
    expect(published.map((request) => request.timeout)).toEqual([1234]);
  });
});
