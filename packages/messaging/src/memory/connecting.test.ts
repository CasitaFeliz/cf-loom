import { defineCommand, defineContract, defineEvent, defineSubscription } from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { messaging } from '../index.ts';
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

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1],
  commands: [chargeCardV1],
  subscriptions: [notifyOnCreated],
});

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnCreated: { element: notifyOnCreated, reader: orderBody } },
});

const oneConnection =
  'memory() serves one connection: create another memory() for another messaging()';

const charge = { orderId: 'o-1' };

/** A memory() connected to the Contract and consuming, its ChargeCard Handler as given. */
async function running(chargeCard: (orderId: string, deliveryCount: number) => Promise<void>) {
  const broker = memory();
  const started = await messaging(contract, broker, { onServiceFault: () => undefined });
  await started.consume({
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
  });
  return { broker, ...started };
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
  test('messaging() connects through memory() and closes', async () => {
    const broker = memory();
    const started = await messaging(contract, broker);
    await started.publisher.publish('OrderCreated', { v1: charge });

    await started.close();

    expect(broker.messages).toHaveLength(1);
    await expect(started.publisher.publish('OrderCreated', { v1: charge })).rejects.toThrow(
      'messaging is closed',
    );
  });

  test('a second messaging() through the same memory() rejects, even after the first was closed', async () => {
    const broker = memory();
    const first = await messaging(contract, broker);

    const whileOpen = messaging(contract, broker);
    await first.close();
    const afterClose = messaging(contract, broker);

    await expect(whileOpen).rejects.toThrow(oneConnection);
    await expect(afterClose).rejects.toThrow(oneConnection);
  });

  test('Messages still lined up when messaging closes are left pending, their Handlers never run', async () => {
    const gate = aGate();
    const handled: string[] = [];
    const { broker, sender, close } = await running(async (orderId) => {
      await gate.opened;
      handled.push(orderId);
    });
    await sender.send('ChargeCard', { orderId: 'a' }, { factId: 'a' });
    await sender.send('ChargeCard', { orderId: 'b' }, { factId: 'b' });

    const closing = close();
    gate.open();
    await closing;
    await broker.settled();

    expect(handled).toEqual(['a']);
    expect(broker.pending).toMatchObject([{ messageId: 'ChargeCard.v1:b', deliveryCount: 1 }]);
  });

  test('deliver and redeliver reject after close', async () => {
    const { broker, close } = await running(async () => undefined);
    await close();

    const delivering = broker.deliver(chargeCardV1, charge);
    const redelivering = broker.redeliver();

    await expect(delivering).rejects.toThrow('memory connection is closed');
    await expect(redelivering).rejects.toThrow('memory connection is closed');
  });

  test('redeliver while closing raises deliveryCount without running the Handler', async () => {
    const gate = aGate();
    const handled: string[] = [];
    const { broker, sender, close } = await running(async (orderId, deliveryCount) => {
      handled.push(`${orderId}:${deliveryCount}`);
      if (orderId === 'hold') {
        await gate.opened;
      } else {
        throw new Error('gateway down');
      }
    });
    await sender.send('ChargeCard', { orderId: 'x' }, { factId: 'x' });
    await broker.settled().catch(() => undefined);
    await sender.send('ChargeCard', { orderId: 'hold' }, { factId: 'hold' });

    const closing = close();
    const redelivering = broker.redeliver();
    gate.open();
    await Promise.all([closing, redelivering]);

    expect(handled).toEqual(['x:1', 'hold:1']);
    expect(broker.pending).toMatchObject([{ messageId: 'ChargeCard.v1:x', deliveryCount: 2 }]);
  });
});
