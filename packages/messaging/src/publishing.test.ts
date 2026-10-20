import { defineCommand, defineContract, defineEvent, openEnum } from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  InvalidMessageError,
  messaging,
  type OutgoingMessage,
  PublishError,
} from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const statuses = ['pending', 'paid'] as const;

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'retired',
  description: 'An order was created',
  body: z.object({ orderId: z.uuid() }),
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created, with its total',
  body: z.object({ orderId: z.uuid(), total: z.number().min(0) }),
});

const orderCreatedV3 = defineEvent({
  name: 'OrderCreated',
  version: 3,
  visibility: 'internal',
  description: 'An order was created, with its total and status',
  body: z.object({
    orderId: z.uuid(),
    total: z.object({ amount: z.number().min(0), currency: z.string() }),
    status: openEnum(statuses),
  }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  lifecycle: 'deprecated',
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const chargeCardV2 = defineCommand({
  name: 'ChargeCard',
  version: 2,
  description: 'Charges the order’s card, for an amount',
  body: z.object({ orderId: z.uuid(), amount: z.number().min(0) }),
});

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV3, orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1, chargeCardV2],
});

const v2 = { orderId: ORDER_ID, total: 12 };

const v3 = {
  orderId: ORDER_ID,
  total: { amount: 12, currency: 'EUR' },
  status: 'paid',
} as const;

const charge = { orderId: ORDER_ID, amount: 12 };

/** A broker that records what messaging publishes, failing the publish numbered `failingAt`. */
function aBroker(failingAt?: number) {
  const published: OutgoingMessage[] = [];
  const error = new Error('broker down');
  let publishes = 0;
  const broker: Broker = {
    connect: async () => ({
      publish: async (message) => {
        publishes += 1;
        if (publishes === failingAt) {
          throw error;
        }
        published.push(message);
      },
      consume: async () => undefined,
      close: async () => undefined,
    }),
  };
  return { broker, published, error };
}

async function connected(failingAt?: number) {
  const recording = aBroker(failingAt);
  const { connect, publisher, sender } = messaging(contract);
  await connect(recording.broker);
  return { ...recording, publisher, sender };
}

function decoded(message: OutgoingMessage | undefined): unknown {
  return JSON.parse(new TextDecoder().decode(message?.body));
}

async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('publisher.publish', () => {
  test('publish sends one Message per Active and Deprecated version, in version order, on <service>.event.<Name>.v<n>', async () => {
    const { publisher, published } = await connected();

    await publisher.publish('OrderCreated', { v2, v3 });

    expect(published.map((message) => message.subject)).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service.event.OrderCreated.v3',
    ]);
  });

  test('a Retired version is never sent, even given a body', async () => {
    const { publisher, published } = await connected();

    await publisher.publish('OrderCreated', { v1: { orderId: ORDER_ID }, v2, v3 } as never);

    expect(published.map((message) => message.subject)).not.toContain(
      'orders-service.event.OrderCreated.v1',
    );
  });

  test('each body leaves as the UTF-8 JSON of the parsed body, unknown keys stripped', async () => {
    const { publisher, published } = await connected();
    const withExtra = { ...v2, extra: 'dropped' };

    await publisher.publish('OrderCreated', { v2: withExtra, v3 });

    expect(published.map(decoded)).toEqual([v2, v3]);
  });

  test('the Messages of one call share a random Fact id, and two calls differ', async () => {
    const { publisher, published } = await connected();

    await publisher.publish('OrderCreated', { v2, v3 });
    await publisher.publish('OrderCreated', { v2, v3 });

    const [first, second, third] = published.map((message) => message.factId);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  test('a Fact id given is the Fact id sent', async () => {
    const { publisher, published } = await connected();

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    expect(published.map((message) => message.factId)).toEqual(['o-1:created', 'o-1:created']);
  });

  test('each broker message id is <Name>.v<n>:<factId>', async () => {
    const { publisher, published } = await connected();

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    expect(published.map((message) => message.messageId)).toEqual([
      'OrderCreated.v2:o-1:created',
      'OrderCreated.v3:o-1:created',
    ]);
  });

  test('transport headers reach the broker as given', async () => {
    const { publisher, published } = await connected();
    const headers = { traceparent: '00-abc-def-01' };

    await publisher.publish('OrderCreated', { v2, v3 }, { headers });

    expect(published.map((message) => message.headers)).toEqual([headers, headers]);
  });

  test.each(['Nats-Msg-Id', 'Cf-Loom-Fact-Id', 'nats-msg-id', 'CF-LOOM-FACT-ID'])(
    'a header named %s throws and nothing is sent',
    async (name) => {
      const { publisher, published } = await connected();

      const publishing = publisher.publish(
        'OrderCreated',
        { v2, v3 },
        { headers: { [name]: 'x' } },
      );

      await expect(publishing).rejects.toThrow(
        `The transport header ${name} takes a name cf-loom sets itself`,
      );
      expect(published).toEqual([]);
    },
  );

  test('an empty Fact id throws and nothing is sent', async () => {
    const { publisher, published } = await connected();

    const publishing = publisher.publish('OrderCreated', { v2, v3 }, { factId: '' });

    await expect(publishing).rejects.toThrow('A Fact id is a non-empty string');
    expect(published).toEqual([]);
  });

  test('a body that breaks its version’s schema throws InvalidMessageError naming the version and the path, and no version is sent', async () => {
    const { publisher, published } = await connected();
    const broken = { ...v3, total: { amount: -1, currency: 'EUR' } };

    const error = await rejectionOf(publisher.publish('OrderCreated', { v2, v3: broken }));

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({
      message: expect.stringMatching(/^OrderCreated@3: body\.total\.amount too_small: /),
      issues: [{ part: 'body', path: ['total', 'amount'], code: 'too_small' }],
    });
    expect(published).toEqual([]);
  });

  test('a version the broker fails throws PublishError naming the Fact id and the versions already sent, with the broker’s error as cause', async () => {
    const { publisher, error } = await connected(2);

    const thrown = await rejectionOf(
      publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' }),
    );

    expect(thrown).toBeInstanceOf(PublishError);
    expect(thrown).toMatchObject({ factId: 'o-1:created', sent: ['OrderCreated@2'], cause: error });
  });

  test('retrying with the same Fact id sends the same broker message ids', async () => {
    const { publisher, published } = await connected(2);
    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1' }).catch(() => undefined);

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1' });

    expect(published.map((message) => message.messageId)).toEqual([
      'OrderCreated.v2:o-1',
      'OrderCreated.v2:o-1',
      'OrderCreated.v3:o-1',
    ]);
  });

  test('a name the root does not publish throws at runtime', async () => {
    const { publisher } = await connected();

    const publishing = publisher.publish('OrderShipped' as never, {} as never);

    await expect(publishing).rejects.toThrow('OrderShipped is no Event the Contract publishes');
  });

  test('bodies missing a live version throw InvalidMessageError at runtime', async () => {
    const { publisher, published } = await connected();

    const error = await rejectionOf(publisher.publish('OrderCreated', { v3 } as never));

    expect(error).toMatchObject({ issues: [{ part: 'body', path: [], code: 'required' }] });
    expect(published).toEqual([]);
  });
});

describe('sender.send', () => {
  test('send sends the Command’s one Active version on <service>.command.<Name>.v<n>, never a Deprecated one', async () => {
    const { sender, published } = await connected();

    await sender.send('ChargeCard', charge);

    expect(published.map((message) => message.subject)).toEqual([
      'orders-service.command.ChargeCard.v2',
    ]);
  });

  test('send’s Message carries a Fact id and a broker message id as publish’s does', async () => {
    const { sender, published } = await connected();

    await sender.send('ChargeCard', charge, { factId: 'o-1:charge' });

    expect(published).toMatchObject([
      { factId: 'o-1:charge', messageId: 'ChargeCard.v2:o-1:charge', headers: {} },
    ]);
    expect(decoded(published[0])).toEqual(charge);
  });

  test('a body that breaks the schema throws InvalidMessageError and nothing is sent', async () => {
    const { sender, published } = await connected();

    const error = await rejectionOf(sender.send('ChargeCard', { ...charge, amount: -1 }));

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({ message: expect.stringMatching(/^ChargeCard@2: body\.amount /) });
    expect(published).toEqual([]);
  });

  test('a broker failure rejects send with the broker’s error', async () => {
    const { sender, error } = await connected(1);

    const sending = sender.send('ChargeCard', charge);

    await expect(sending).rejects.toBe(error);
  });
});
