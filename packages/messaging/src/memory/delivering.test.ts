import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { handle, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type ConsumedFault, type Messaging, messaging } from '../index.ts';
import { memory } from './index.ts';

const statuses = ['pending', 'paid'] as const;

const orderBody = z.object({ orderId: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created',
  body: orderBody,
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created, with its status',
  body: z.object({ orderId: z.string(), status: openEnum(statuses) }),
});

const orderArchivedV1 = defineEvent({
  name: 'OrderArchived',
  version: 1,
  visibility: 'internal',
  description: 'An order was archived',
  body: orderBody,
});

const orderAuditedV1 = defineEvent({
  name: 'OrderAudited',
  version: 1,
  visibility: 'internal',
  description: 'An order was audited',
  body: orderBody,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

const notifyOnV1 = defineSubscription({
  name: 'notifyOnV1',
  description: 'Notify on v1',
  event: orderCreatedV1,
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV2,
});

const auditCreated = defineSubscription({
  name: 'auditCreated',
  description: 'Audit created',
  event: orderCreatedV2,
});

const onAudited = defineSubscription({
  name: 'onAudited',
  description: 'On audited',
  event: orderAuditedV1,
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      events: [orderCreatedV1, orderArchivedV1],
      commands: [chargeCardV1],
    }),
    defineGroup({
      name: 'audits',
      description: 'Audits',
      events: [orderCreatedV2, orderAuditedV1],
      subscriptions: [notifyOnV1, notifyOnCreated, auditCreated, onAudited],
    }),
  ],
});

const readerV2 = z.object({ orderId: z.string(), status: openEnumReader(statuses) });

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: {
    notifyOnV1: { element: notifyOnV1, reader: orderBody },
    notifyOnCreated: { element: notifyOnCreated, reader: readerV2 },
    auditCreated: { element: auditCreated, reader: readerV2 },
    onAudited: { element: onAudited, reader: z.object({ orderId: z.uuid() }) },
  },
});

type Received = { readonly handler: string; readonly body: unknown; readonly meta: MessageMeta };

/** A Handler implementation that keeps what it receives under its name. */
function recorder(received: Received[], handler: string) {
  return (body: unknown, meta: MessageMeta): undefined => {
    received.push({ handler, body, meta });
  };
}

type Replaced = { readonly commands?: object; readonly subscriptions?: object };

/** A memory() connected to the Contract, not yet consuming, and the faults its Service received. */
async function connected() {
  const broker = memory();
  const faults: ConsumedFault[] = [];
  const started = await messaging(contract, broker, {
    onServiceFault: (fault) => {
      faults.push(fault);
    },
  });
  return { broker, faults, started };
}

/** The Handler map, every Handler recording what it receives, replaced by those given. */
function handlersOf(received: Received[], replaced: Replaced = {}) {
  return {
    commands: {
      chargeCardV1: handle(readers.commands.chargeCardV1, recorder(received, 'ChargeCard@1')),
      ...replaced.commands,
    },
    subscriptions: {
      notifyOnV1: handle(readers.subscriptions.notifyOnV1, recorder(received, 'notifyOnV1')),
      notifyOnCreated: handle(
        readers.subscriptions.notifyOnCreated,
        recorder(received, 'notifyOnCreated'),
      ),
      auditCreated: handle(readers.subscriptions.auditCreated, recorder(received, 'auditCreated')),
      onAudited: handle(readers.subscriptions.onAudited, recorder(received, 'onAudited')),
      ...replaced.subscriptions,
    },
    readers,
  };
}

/** A memory() connected to the Contract and consuming. */
async function running(
  replaced: (started: Messaging<typeof contract>) => Replaced = () => ({}),
  received: Received[] = [],
) {
  const { broker, faults, started } = await connected();
  await started.consume(handlersOf(received, replaced(started)));
  return { broker, faults, received, ...started };
}

/** A promise a test settles itself, to hold a Handler while it runs. */
function aGate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Lets every Handler that can run, run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const v1Body = { orderId: 'o-1' };

const v2Body = { orderId: 'o-1', status: 'paid' } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memory(): what the Service publishes and sends', () => {
  test('a published Event reaches the Service’s own Subscription to that version, its body read with the Subscription’s Reader', async () => {
    const { publisher, broker, received } = await running();

    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'f-24' });
    await broker.settled();

    const notified = received.filter(({ handler }) => handler === 'notifyOnCreated');
    expect(notified.map(({ body }) => body)).toEqual([{ orderId: 'o-1', status: 'paid' }]);
  });

  test('each version of a published Event reaches only the Subscriptions to that version', async () => {
    const { publisher, broker, received } = await running();

    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'f-25' });
    await broker.settled();

    expect(received.map(({ handler, body }) => [handler, body])).toEqual([
      ['notifyOnCreated', v2Body],
      ['auditCreated', v2Body],
      ['notifyOnV1', v1Body],
    ]);
  });

  test('an Event two Subscriptions take reaches each, one after the other, in the order consume was given them', async () => {
    const gate = aGate();
    const log: string[] = [];
    const { publisher, broker } = await running(() => ({
      subscriptions: {
        notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, async () => {
          log.push('notify starts');
          await gate.opened;
          log.push('notify ends');
        }),
        auditCreated: handle(readers.subscriptions.auditCreated, () => {
          log.push('audit');
        }),
      },
    }));
    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'f-26' });

    await flush();
    const whileHeld = [...log];
    gate.open();
    await broker.settled();

    expect(whileHeld).toEqual(['notify starts']);
    expect(log).toEqual(['notify starts', 'notify ends', 'audit']);
  });

  test('a sent Command reaches its Message Handler', async () => {
    const { sender, broker, received } = await running();

    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-27' });
    await broker.settled();

    expect(received.map(({ handler, body }) => [handler, body])).toEqual([
      ['ChargeCard@1', { orderId: 'o-1' }],
    ]);
  });

  test('the Handler receives the broker message id, the Fact id, deliveryCount 1 and the transport headers it was published with', async () => {
    const { publisher, broker, received } = await running();
    const headers = { traceparent: '00-abc-def-01' };

    await publisher.publish(
      'OrderCreated',
      { v1: v1Body, v2: v2Body },
      { factId: 'o-1:created', headers },
    );
    await broker.settled();

    const notified = received.find(({ handler }) => handler === 'notifyOnCreated');
    expect(notified?.meta).toEqual({
      messageId: 'event.OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      deliveryCount: 1,
      lastAttempt: false,
      headers,
      signal: expect.any(AbortSignal),
    });
  });

  test('Messages are delivered one at a time in publish order, a Handler’s own sends after the Messages already lined up', async () => {
    const gate = aGate();
    const log: string[] = [];
    const { sender, broker } = await running((started) => ({
      commands: {
        chargeCardV1: handle(readers.commands.chargeCardV1, async ({ orderId }) => {
          log.push(`${orderId} starts`);
          if (orderId === 'a') {
            await gate.opened;
            await started.sender.send('ChargeCard', { orderId: 'c' }, { factId: 'f-29' });
          }
          await Promise.resolve();
          log.push(`${orderId} ends`);
        }),
      },
    }));
    await sender.send('ChargeCard', { orderId: 'a' }, { factId: 'f-30' });
    await sender.send('ChargeCard', { orderId: 'b' }, { factId: 'f-31' });

    gate.open();
    await broker.settled();

    expect(log).toEqual(['a starts', 'a ends', 'b starts', 'b ends', 'c starts', 'c ends']);
  });

  test('publish resolves once the Message is recorded, without waiting for its Handlers', async () => {
    const gate = aGate();
    const handled: unknown[] = [];
    const { publisher, broker } = await running(() => ({
      subscriptions: {
        notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, async (body) => {
          await gate.opened;
          handled.push(body);
        }),
      },
    }));

    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'f-32' });
    const recordedMeanwhile = broker.messages.length;
    const handledMeanwhile = [...handled];
    gate.open();
    await broker.settled();

    expect(recordedMeanwhile).toBe(2);
    expect(handledMeanwhile).toEqual([]);
    expect(handled).toEqual([v2Body]);
  });

  test('an Event no Subscription takes is recorded and delivered nowhere', async () => {
    const { publisher, broker, received } = await running();

    await publisher.publish('OrderArchived', { v1: v1Body }, { factId: 'f-33' });
    await broker.settled();

    expect(broker.messages.map(({ subject }) => subject)).toEqual([
      'orders-service.event.OrderArchived.v1',
    ]);
    expect(received).toEqual([]);
  });

  test('an Event whose only Subscription is a stub is recorded and delivered nowhere', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { publisher, broker, received } = await running(() => ({
      subscriptions: { notifyOnV1: handle.stub(readers.subscriptions.notifyOnV1) },
    }));

    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'f-34' });
    await broker.settled();

    expect(broker.messages.map(({ subject }) => subject)).toContain(
      'orders-service.event.OrderCreated.v1',
    );
    expect(received.map(({ handler }) => handler)).toEqual(['notifyOnCreated', 'auditCreated']);
  });

  test('a Message published before consume is recorded and never delivered', async () => {
    const received: Received[] = [];
    const { broker, started } = await connected();
    await started.publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'f-35' });

    await started.consume(handlersOf(received));
    await broker.settled();

    expect(broker.messages).toHaveLength(2);
    expect(received).toEqual([]);
  });

  test('messages lists each Message published or sent, in order, with its subject, broker message id, Fact id, transport headers and body', async () => {
    const { publisher, sender, broker } = await running();
    const headers = { traceparent: '00-abc-def-01' };

    await publisher.publish(
      'OrderCreated',
      { v1: v1Body, v2: v2Body },
      { factId: 'o-1:created', headers },
    );
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'o-1:charge' });

    expect(broker.messages).toEqual([
      {
        subject: 'orders-service.event.OrderCreated.v2',
        messageId: 'event.OrderCreated.v2:o-1:created',
        factId: 'o-1:created',
        headers,
        body: v2Body,
      },
      {
        subject: 'orders-service.event.OrderCreated.v1',
        messageId: 'event.OrderCreated.v1:o-1:created',
        factId: 'o-1:created',
        headers,
        body: v1Body,
      },
      {
        subject: 'orders-service.command.ChargeCard.v1',
        messageId: 'command.ChargeCard.v1:o-1:charge',
        factId: 'o-1:charge',
        headers: {},
        body: { orderId: 'o-1' },
      },
    ]);
  });

  test('a repeated broker message id is dropped, neither recorded nor delivered, however long after the first', async () => {
    const { publisher, sender, broker, received } = await running();
    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'o-1' });
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'o-1' });
    await broker.settled();

    await publisher.publish('OrderCreated', { v1: v1Body, v2: v2Body }, { factId: 'o-1' });
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'o-1' });
    await broker.settled();

    expect(broker.messages).toHaveLength(3);
    expect(received).toHaveLength(4);
  });

  test('a Message that fails its Reader is ended and its Handler never runs', async () => {
    const { publisher, broker, received, faults } = await running();

    await publisher.publish('OrderAudited', { v1: { orderId: 'not-a-uuid' } }, { factId: 'f-42' });
    const settling = broker.settled();

    await expect(settling).rejects.toThrow('onAudited');
    expect(received).toEqual([]);
    expect(faults).toMatchObject([
      { kind: 'invalid-body', element: onAudited, identity: 'onAudited' },
    ]);
    expect(broker.pending).toEqual([]);
  });
});
