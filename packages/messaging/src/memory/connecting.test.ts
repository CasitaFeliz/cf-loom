import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
} from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { memory } from './index.ts';

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

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnCreated: { element: notifyOnCreated, reader: orderBody } },
});

const charge = { orderId: 'o-1' };

/** A memory() of the Contract and consuming, its ChargeCard Handler as given. */
async function running(chargeCard: (orderId: string, deliveryCount: number) => Promise<void>) {
  const inMemory = await memory(contract, { onServiceFault: () => undefined });
  await inMemory.consume(
    {
      commands: {
        chargeCardV1: handle(
          readers.commands.chargeCardV1,
          async ({ orderId }, { deliveryCount }) => {
            await chargeCard(orderId, deliveryCount);
          },
        ),
      },
      subscriptions: {
        notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, () => undefined),
      },
      readers,
    },
    {},
  );
  return inMemory;
}

/** A promise a test settles itself, to hold a Handler while it runs. */
function aGate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('memory(): one connection', () => {
  test('memory(contract) resolves to a Messaging that publishes, consumes and closes', async () => {
    const handled: string[] = [];
    const inMemory = await running(async (orderId) => void handled.push(orderId));
    await inMemory.sender.send('ChargeCard', charge, { factId: 'f-18' });
    await inMemory.settled();

    await inMemory.close();

    expect(handled).toEqual(['o-1']);
    await expect(
      inMemory.publisher.publish('OrderCreated', { v1: charge }, { factId: 'f-19' }),
    ).rejects.toThrow('messaging is closed');
  });

  test('a Message sent just before close() is listed in pending when close() resolves, its Handler never run', async () => {
    const handled: string[] = [];
    const inMemory = await running(async (orderId) => void handled.push(orderId));
    await inMemory.sender.send('ChargeCard', charge, { factId: 'f-20' });

    await inMemory.close();

    expect(inMemory.pending).toMatchObject([
      { messageId: 'command.ChargeCard.v1:f-20', deliveryCount: 1 },
    ]);
    expect(handled).toEqual([]);
  });

  test('Messages still lined up when messaging closes are left pending, their Handlers never run', async () => {
    const gate = aGate();
    const entered = Promise.withResolvers<void>();
    const handled: string[] = [];
    const inMemory = await running(async (orderId) => {
      entered.resolve();
      await gate.opened;
      handled.push(orderId);
    });
    await inMemory.sender.send('ChargeCard', { orderId: 'a' }, { factId: 'a' });
    await inMemory.sender.send('ChargeCard', { orderId: 'b' }, { factId: 'b' });
    const settling = inMemory.settled();
    await entered.promise;

    const closing = inMemory.close();
    const whileClosing = inMemory.pending.map(({ messageId }) => messageId);
    gate.open();
    await closing;
    await settling;

    expect(whileClosing).toEqual(['command.ChargeCard.v1:b']);
    expect(handled).toEqual(['a']);
    expect(inMemory.pending).toMatchObject([
      { messageId: 'command.ChargeCard.v1:b', deliveryCount: 1 },
    ]);
  });

  test('deliver and redeliver reject after close', async () => {
    const inMemory = await running(async () => undefined);
    await inMemory.close();

    const delivering = inMemory.deliver(chargeCardV1, charge);
    const redelivering = inMemory.redeliver();

    await expect(delivering).rejects.toThrow('memory connection is closed');
    await expect(redelivering).rejects.toThrow('memory connection is closed');
  });

  test('redeliver while closing raises deliveryCount without running the Handler', async () => {
    const gate = aGate();
    const holding = Promise.withResolvers<void>();
    const handled: string[] = [];
    const inMemory = await running(async (orderId, deliveryCount) => {
      handled.push(`${orderId}:${deliveryCount}`);
      if (orderId === 'hold') {
        holding.resolve();
        await gate.opened;
      } else {
        throw new Error('gateway down');
      }
    });
    await inMemory.sender.send('ChargeCard', { orderId: 'x' }, { factId: 'x' });
    await inMemory.settled().catch(() => undefined);
    await inMemory.sender.send('ChargeCard', { orderId: 'hold' }, { factId: 'hold' });
    const settling = inMemory.settled();
    await holding.promise;

    const closing = inMemory.close();
    const redelivering = inMemory.redeliver();
    gate.open();
    await Promise.all([closing, redelivering, settling]);

    expect(handled).toEqual(['x:1', 'hold:1']);
    expect(inMemory.pending).toMatchObject([
      { messageId: 'command.ChargeCard.v1:x', deliveryCount: 2 },
    ]);
  });
});
