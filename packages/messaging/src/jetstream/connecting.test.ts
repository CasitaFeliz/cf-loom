import { defineCommand, defineEvent, defineGroup, defineService } from '@cf-loom/contract';
import { joinedOf } from '@cf-loom/contract/internal';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { z } from 'zod';
import { withMethods } from '../../test/connections.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, arrangeStream } from '../../test/streams.ts';
import { messaging } from '../index.ts';
import { jetstream } from './index.ts';

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

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
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

/** The Service's own `connect`: opens a connection to the test server, keeps it and closes it when the test ends. */
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

const notHeld = (stream: string, subjects: readonly string[]) =>
  `The stream ${stream} does not hold ${joinedOf(subjects, 'and')}: apply the Service's Broker plan`;

const absent = (stream: string) =>
  `The stream ${stream} does not exist: apply the Service's Broker plan`;

describe('jetstream()', () => {
  test.each(['stag_ing', 'a.b', 'Staging', '', 'a'.repeat(65)])(
    'jetstream() refuses the prefix "%s", which is not a Broker prefix, naming it and saying to leave it undefined for none',
    (prefix) => {
      const broker = () => jetstream({ connect: aConnect().connect, prefix });

      expect(broker).toThrow(
        `The broker prefix "${prefix}" is not kebab-case of at most 64 characters, such as staging: leave prefix undefined for none`,
      );
    },
  );

  test('each messaging() through jetstream() calls the Service’s connect once, and jetstream() itself connects nothing', async () => {
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const service = aConnect();

    const broker = jetstream({ connect: service.connect, prefix });
    const connectedBefore = service.opened.length;
    await messaging(contract, broker);
    await messaging(contract, broker);

    expect(connectedBefore).toBe(0);
    expect(service.opened).toHaveLength(2);
  });

  test('messaging() rejects with the error the Service’s connect rejected with', async () => {
    const error = new Error('no route to NATS');

    const opening = messaging(
      contract,
      jetstream({
        connect: () => Promise.reject(error),
        prefix: aPrefix(),
      }),
    );

    await expect(opening).rejects.toBe(error);
  });

  test('messaging() connects when the Service’s prefixed stream holds every subject it publishes and sends', async () => {
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const service = aConnect();

    const opening = messaging(contract, jetstream({ connect: service.connect, prefix }));

    await expect(opening).resolves.toBeDefined();
  });

  test('messaging() connects when the Service’s stream holds its subjects through a wildcard', async () => {
    const prefix = aPrefix();
    const name = `${prefix}_orders-service`;
    await arrangeStream(server.url, { name, subjects: [`${prefix}.orders-service.>`] });
    const service = aConnect();

    const opening = messaging(contract, jetstream({ connect: service.connect, prefix }));

    await expect(opening).resolves.toBeDefined();
  });

  test('messaging() rejects naming the prefixed stream and each subject it does not hold, and drains the connection it opened', async () => {
    const prefix = aPrefix();
    const name = `${prefix}_orders-service`;
    await arrangeStream(server.url, { name, subjects: [`${prefix}.orders-service.other`] });
    const service = aConnect();

    const opening = messaging(contract, jetstream({ connect: service.connect, prefix }));

    await expect(opening).rejects.toThrow(
      notHeld(name, [
        `${prefix}.orders-service.event.OrderCreated.v1`,
        `${prefix}.orders-service.command.ChargeCard.v1`,
      ]),
    );
    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('messaging() names only the subjects the stream does not hold', async () => {
    const prefix = aPrefix();
    const name = `${prefix}_orders-service`;
    const event = `${prefix}.orders-service.event.OrderCreated.v1`;
    await arrangeStream(server.url, { name, subjects: [event] });
    const service = aConnect();

    const opening = messaging(contract, jetstream({ connect: service.connect, prefix }));

    await expect(opening).rejects.toThrow(
      notHeld(name, [`${prefix}.orders-service.command.ChargeCard.v1`]),
    );
  });

  test('messaging() refusing a stream that does not exist rejects with that refusal and closes the connection, though its drain is not answered', async () => {
    const prefix = aPrefix();
    const opened: NatsConnection[] = [];
    const connectUndrainable = async (): Promise<NatsConnection> => {
      const connection = await connect({ servers: server.url });
      onTestFinished(() => connection.close());
      opened.push(connection);
      return withMethods(connection, { drain: () => Promise.reject(new Error('no answer')) });
    };

    const opening = messaging(contract, jetstream({ connect: connectUndrainable, prefix }));

    await expect(opening).rejects.toThrow(absent(`${prefix}_orders-service`));
    expect(opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('messaging() rejects naming its own stream as absent when another stream holds its subjects', async () => {
    const prefix = aPrefix();
    const subjects = [`${prefix}.orders-service.>`];
    await arrangeStream(server.url, { name: `${prefix}_somebody-else`, subjects });
    const service = aConnect();

    const opening = messaging(contract, jetstream({ connect: service.connect, prefix }));

    await expect(opening).rejects.toThrow(absent(`${prefix}_orders-service`));
  });

  test('messaging() rejects naming a stream that does not exist and the broker plan, and drains the connection it opened', async () => {
    const prefix = aPrefix();
    const service = aConnect();

    const opening = messaging(contract, jetstream({ connect: service.connect, prefix }));

    await expect(opening).rejects.toThrow(absent(`${prefix}_orders-service`));
    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test.each([
    ['holds every subject', 2, (prefix: string) => arrangePlanOf(server.url, contract, prefix)],
    ['does not exist', 3, () => Promise.resolve()],
    [
      'holds only some subjects',
      3,
      (prefix: string) =>
        arrangeStream(server.url, {
          name: `${prefix}_orders-service`,
          subjects: [`${prefix}.orders-service.event.OrderCreated.v1`],
        }),
    ],
  ])(
    'messaging() checks a Service’s stream that %s with %i $JS.API.STREAM.NAMES requests and no other',
    async (_name, requests, arrange) => {
      const prefix = aPrefix();
      await arrange(prefix);
      const requested: string[] = [];
      const connectRecording = async (): Promise<NatsConnection> => {
        const connection = await connect({ servers: server.url });
        onTestFinished(() => connection.close());
        return withMethods(connection, {
          request: (subject, payload, options) => {
            requested.push(subject);
            return connection.request(subject, payload, options);
          },
        });
      };

      await messaging(contract, jetstream({ connect: connectRecording, prefix })).catch(
        () => undefined,
      );

      expect(requested).toEqual(Array(requests).fill('$JS.API.STREAM.NAMES'));
    },
  );

  test('messaging() rejects with the stream check’s own error when the Service’s connection is already closed', async () => {
    const checkFailure = new Error('the Broker did not answer');
    const connectClosed = async () => {
      const connection = await connect({ servers: server.url });
      await connection.close();
      return withMethods(connection, { request: () => Promise.reject(checkFailure) });
    };

    const opening = messaging(contract, jetstream({ connect: connectClosed, prefix: aPrefix() }));

    await expect(opening).rejects.toBe(checkFailure);
  });

  test('a Service that publishes and sends nothing connects with no stream on the Broker', async () => {
    const quiet = defineService({ name: 'quiet-service' });
    const service = aConnect();

    const opening = messaging(quiet, jetstream({ connect: service.connect, prefix: aPrefix() }));

    await expect(opening).resolves.toBeDefined();
  });

  test('without a prefix, the stream checked is the one named after the Service, on unprefixed subjects', async () => {
    const orders = defineGroup({ name: 'orders', description: 'Orders', events: [orderCreatedV1] });
    const unprefixed = defineService({ name: 'unprefixed-service', groups: [orders] });
    await arrangeStream(server.url, {
      name: 'unprefixed-service',
      subjects: ['unprefixed-service.event.OrderCreated.v1'],
    });
    const service = aConnect();

    const opening = messaging(unprefixed, jetstream({ connect: service.connect }));

    await expect(opening).resolves.toBeDefined();
  });

  test('the jetstream options reach the JetStream client: an unknown domain rejects messaging() with the client’s error', async () => {
    const prefix = aPrefix();
    await arrangePlanOf(server.url, contract, prefix);
    const service = aConnect();
    const broker = jetstream({
      connect: service.connect,
      prefix,
      jetstream: { domain: 'nowhere' },
    });

    const opening = messaging(contract, broker);

    await expect(opening).rejects.toThrow('jetstream is not enabled');
  });
});
