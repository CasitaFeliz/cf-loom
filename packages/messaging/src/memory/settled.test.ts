import {
  defineCommand,
  defineContract,
  defineEvent,
  defineGroup,
  defineSubscription,
} from '@cf-loom/contract';
import { fault, handle, type MessageFault, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Messaging, type MessagingOptions, messaging } from '../index.ts';
import { type MemoryBroker, memory } from './index.ts';

const orderBody = z.object({ orderId: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
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

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

const onAudited = defineSubscription({
  name: 'onAudited',
  description: 'On audited',
  event: orderAuditedV1,
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, orderAuditedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated, onAudited],
    }),
  ],
});

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: {
    notifyOnCreated: { element: notifyOnCreated, reader: orderBody },
    onAudited: { element: onAudited, reader: z.object({ orderId: z.uuid() }) },
  },
});

type Implementation = (
  body: { readonly orderId: string },
  meta: MessageMeta,
) => MessageFault | undefined | Promise<MessageFault | undefined>;

type Handlers = {
  readonly charge?: Implementation;
  readonly notify?: Implementation;
};

/** A memory() and the messaging connected through it. */
type Running = Messaging<typeof contract> & { readonly broker: MemoryBroker };

/** A memory() connected to the Contract and consuming with the Handlers given, the others acknowledging. */
async function running(
  handlers: (connection: Running) => Handlers = () => ({}),
  options: MessagingOptions = {},
): Promise<Running> {
  const broker = memory();
  const started = await messaging(contract, broker, options);
  const connection = { broker, ...started };
  const { charge, notify } = handlers(connection);
  await started.consume({
    commands: { chargeCardV1: handle(readers.commands.chargeCardV1, charge ?? (() => undefined)) },
    subscriptions: {
      notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, notify ?? (() => undefined)),
      onAudited: handle(readers.subscriptions.onAudited, () => undefined),
    },
    readers,
  });
  return connection;
}

/** A promise a test settles itself, to hold a Handler while it runs. */
function aGate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** What `settled()` rejected with, or undefined when it resolved. */
async function rejectionOf(settling: Promise<void>): Promise<Error | undefined> {
  try {
    await settling;
    return undefined;
  } catch (e) {
    return e instanceof Error ? e : undefined;
  }
}

const created = { orderId: 'o-1' };

describe('settled()', () => {
  test('settled() with nothing in flight resolves', async () => {
    const { broker } = await running();

    const settling = broker.settled();

    await expect(settling).resolves.toBeUndefined();
  });

  test('settled() resolves once every Message, and every Message its Handlers publish or send meanwhile, has been handled', async () => {
    const gate = aGate();
    const charged: string[] = [];
    const { broker, publisher } = await running((connection) => ({
      notify: async () => {
        await gate.opened;
        await connection.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-53' });
        return undefined;
      },
      charge: ({ orderId }) => {
        charged.push(orderId);
        return undefined;
      },
    }));
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'f-54' });

    const settling = broker.settled();
    gate.open();
    await settling;

    expect(charged).toEqual(['o-1']);
  });

  test('settled() rejects when a Handler threw, with the ConsumedFault as cause', async () => {
    const error = new Error('gateway down');
    const { broker, publisher } = await running(() => ({
      notify: () => {
        throw error;
      },
    }));
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'o-1' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.cause).toEqual({
      element: notifyOnCreated,
      identity: 'notifyOnCreated',
      subject: 'orders-service.event.OrderCreated.v1',
      messageId: 'event.OrderCreated.v1:o-1',
      factId: 'o-1',
      deliveryCount: 1,
      lastAttempt: false,
      kind: 'thrown',
      cause: error,
    });
  });

  test.each<[string, Handlers, (connection: Running) => Promise<unknown>]>([
    [
      'a non-retryable Fault',
      { charge: () => fault({ committed: 'no', retryable: false, message: 'Card refused' }) },
      ({ sender }) => sender.send('ChargeCard', created, { factId: 'f-56' }),
    ],
    [
      'a body that fails its Reader',
      {},
      ({ publisher }) =>
        publisher.publish('OrderAudited', { v1: { orderId: 'not-a-uuid' } }, { factId: 'f-57' }),
    ],
  ])('settled() rejects when a Message was ended, for %s', async (_ended, handlers, ending) => {
    const connection = await running(() => handlers);
    await ending(connection);

    const rejection = await rejectionOf(connection.broker.settled());

    expect(rejection).toBeInstanceOf(Error);
  });

  test('a retryable Fault makes settled() reject with its line', async () => {
    const { broker, sender } = await running(() => ({
      charge: () => fault({ committed: 'no', retryable: true, message: 'card 503' }),
    }));
    await sender.send('ChargeCard', created, { factId: 'o-1' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.message).toBe(
      'ChargeCard@1 orders-service.command.ChargeCard.v1 command.ChargeCard.v1:o-1 o-1 attempt 1: card 503',
    );
    expect(rejection?.cause).toMatchObject({ kind: 'returned', deliveryCount: 1 });
    expect(broker.pending).toHaveLength(1);
  });

  test('the rejection’s message has one line per failure since the last settled()', async () => {
    const { broker, publisher, sender } = await running(() => ({
      notify: () => {
        throw new Error('gateway down');
      },
      charge: () => fault({ committed: 'no', retryable: false, message: 'Card refused' }),
    }));
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'o-1' });
    await sender.send('ChargeCard', created, { factId: 'o-1' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.message).toBe(
      [
        'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1 attempt 1: the Handler threw',
        'ChargeCard@1 orders-service.command.ChargeCard.v1 command.ChargeCard.v1:o-1 o-1 attempt 1: Card refused',
      ].join('\n'),
    );
  });

  test('with several failures since the last settled(), the cause is the first failure’s', async () => {
    const { broker, publisher, sender } = await running(() => ({
      notify: () => {
        throw new Error('gateway down');
      },
      charge: () => fault({ committed: 'no', retryable: false, message: 'Card refused' }),
    }));
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'f-61' });
    await sender.send('ChargeCard', created, { factId: 'f-62' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.cause).toMatchObject({ kind: 'thrown', identity: 'notifyOnCreated' });
  });

  test('a failure is reported once: the next settled() resolves', async () => {
    const { broker, sender } = await running(() => ({
      charge: () => fault({ committed: 'no', retryable: false }),
    }));
    await sender.send('ChargeCard', created, { factId: 'f-63' });
    await rejectionOf(broker.settled());

    const settling = broker.settled();

    await expect(settling).resolves.toBeUndefined();
  });

  test('a failure in a Message deliver hands in makes settled() reject too', async () => {
    const { broker } = await running(() => ({
      notify: () => {
        throw new Error('gateway down');
      },
    }));

    const settlement = await broker.deliver(orderCreatedV1, created);
    const rejection = await rejectionOf(broker.settled());

    expect(settlement).toBe('pending');
    expect(rejection?.cause).toMatchObject({ kind: 'thrown', identity: 'notifyOnCreated' });
  });

  test('settled() rejects with the Fault’s line and the onServiceFault threw line when onServiceFault throws', async () => {
    const hook = new Error('the hook broke');
    const { broker, publisher } = await running(
      () => ({
        notify: () => {
          throw new Error('gateway down');
        },
      }),
      {
        onServiceFault: () => {
          throw hook;
        },
      },
    );
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'o-1' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.message).toBe(
      [
        'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1 attempt 1: the Handler threw',
        'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1 attempt 1: onServiceFault threw',
      ].join('\n'),
    );
    expect(rejection?.cause).toMatchObject({ kind: 'thrown', identity: 'notifyOnCreated' });
    expect(broker.pending).toMatchObject([{ element: notifyOnCreated, deliveryCount: 1 }]);
  });

  test('an onServiceFault that rejects leaves pending a Message it would have ended, and makes settled() reject', async () => {
    const { broker, publisher } = await running(
      () => ({
        notify: () => fault({ committed: 'no', retryable: false, message: 'Not notified' }),
      }),
      { onServiceFault: async () => Promise.reject(new Error('the hook broke')) },
    );
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'o-1' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.message).toBe(
      [
        'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1 attempt 1: Not notified',
        'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1 attempt 1: onServiceFault threw',
      ].join('\n'),
    );
    expect(rejection?.cause).toMatchObject({ kind: 'returned', identity: 'notifyOnCreated' });
    expect(broker.pending).toMatchObject([{ element: notifyOnCreated, deliveryCount: 1 }]);
  });

  test('a Message a Handler publishes while messaging is closing is left pending, its Handler never run, and settled() resolves', async () => {
    const gate = aGate();
    const charged: string[] = [];
    const { broker, publisher, sender, close } = await running(() => ({
      notify: async () => {
        await gate.opened;
        await sender.send('ChargeCard', created, { factId: 'o-1:charge' });
        return undefined;
      },
      charge: ({ orderId }) => {
        charged.push(orderId);
        return undefined;
      },
    }));
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'o-1' });

    const closing = close();
    gate.open();
    await closing;
    const settling = broker.settled();

    await expect(settling).resolves.toBeUndefined();
    expect(charged).toEqual([]);
    expect(broker.pending).toMatchObject([{ identity: 'ChargeCard@1', deliveryCount: 1 }]);
  });

  test('a Message close({ signal }) handed back is listed in pending', async () => {
    const handling = Promise.withResolvers<void>();
    const { broker, close } = await running(() => ({
      notify: () => {
        handling.resolve();
        return new Promise(() => undefined);
      },
    }));
    const delivered = broker.deliver(orderCreatedV1, created, { factId: 'o-1' });
    await handling.promise;

    const closing = close({ signal: AbortSignal.abort() });

    await expect(closing).rejects.toThrow('close stopped waiting and handed back 1 Message');
    await expect(delivered).resolves.toBe('handed-back');
    expect(broker.pending).toMatchObject([
      { identity: 'notifyOnCreated', factId: 'o-1', deliveryCount: 1 },
    ]);
  });

  test('an onServiceFault that rejects causes no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    const { broker, publisher } = await running(
      () => ({
        notify: () => {
          throw new Error('gateway down');
        },
      }),
      { onServiceFault: async () => Promise.reject(new Error('the hook broke')) },
    );

    await publisher.publish('OrderCreated', { v1: created }, { factId: 'o-1' });
    await rejectionOf(broker.settled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', listener);

    expect(unhandled).toEqual([]);
  });
});

describe('settled(): a chain of Messages that keeps producing', () => {
  test('runs that each settle before the next, adding up past 1,000 deliveries, are not cut', async () => {
    const { broker } = await running();
    const settlements: string[] = [];

    for (let delivered = 0; delivered < 1001; delivered += 1) {
      settlements.push(await broker.deliver(chargeCardV1, created));
    }

    expect(settlements.filter((settlement) => settlement === 'acked')).toHaveLength(1001);
    await expect(broker.settled()).resolves.toBeUndefined();
  });

  /** Two Handlers that trigger each other forever: the Subscription sends, the CommandHandler publishes. */
  function chaining(connection: Running, count: { deliveries: number }) {
    return {
      notify: async () => {
        count.deliveries += 1;
        await connection.sender.send('ChargeCard', created, {
          factId: `charge-${count.deliveries}`,
        });
        return undefined;
      },
      charge: async () => {
        count.deliveries += 1;
        await connection.publisher.publish(
          'OrderCreated',
          { v1: created },
          { factId: `created-${count.deliveries}` },
        );
        return undefined;
      },
    };
  }

  test('a chain of Messages that keeps producing is cut after 1,000 deliveries, and settled() rejects', async () => {
    const count = { deliveries: 0 };
    const { broker, publisher } = await running((connection) => chaining(connection, count));
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'f-71' });

    const rejection = await rejectionOf(broker.settled());

    expect(rejection?.message).toBe('a chain of Messages was cut after 1,000 deliveries');
    expect(count.deliveries).toBe(1000);
    expect(broker.messages).toHaveLength(1001);
    expect(broker.pending).toEqual([]);
    await expect(broker.settled()).resolves.toBeUndefined();
  });

  test('a deliver still lined up when a chain is cut rejects with the cut’s error', async () => {
    const count = { deliveries: 0 };
    let lastDelivery: Promise<unknown> = Promise.resolve();
    const { broker, publisher } = await running((connection) => {
      const { notify, charge } = chaining(connection, count);
      return {
        notify,
        charge: async () => {
          await charge();
          if (count.deliveries === 1000) {
            lastDelivery = connection.broker
              .deliver(orderCreatedV1, created)
              .catch((e: unknown) => e);
          }
          return undefined;
        },
      };
    });
    await publisher.publish('OrderCreated', { v1: created }, { factId: 'f-72' });
    await rejectionOf(broker.settled());

    const cut = await lastDelivery;

    expect(cut).toEqual(new Error('a chain of Messages was cut after 1,000 deliveries'));
  });
});
