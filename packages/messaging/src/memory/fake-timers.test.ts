import { defineCommand, defineGroup, defineService } from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { memory } from './index.ts';

vi.hoisted(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string() }),
});

const contract = defineService({
  name: 'orders-service',
  groups: [defineGroup({ name: 'messages', description: 'Messages', commands: [chargeCardV1] })],
});

const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {},
});

const charge = { orderId: 'o-1' };

/** A memory() of the Contract and consuming, its Handler recording the order ids it receives. */
async function running() {
  const handled: string[] = [];
  const inMemory = await memory(contract);
  await inMemory.consume(
    {
      commands: {
        chargeCardV1: handle(readers.commands.chargeCardV1, ({ orderId }) => {
          handled.push(orderId);
        }),
      },
      subscriptions: {},
      readers,
    },
    {},
  );
  return { inMemory, handled };
}

describe('memory() under fake timers installed before it loads', () => {
  test('settled() resolves once the Handler of a sent Command has run', async () => {
    const { inMemory, handled } = await running();
    await inMemory.sender.send('ChargeCard', charge, { factId: 'f-1' });

    await inMemory.settled();

    expect(handled).toEqual(['o-1']);
  });

  test('deliver() resolves acked once the Handler has run', async () => {
    const { inMemory, handled } = await running();

    const settlement = await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' });

    expect(settlement).toBe('acked');
    expect(handled).toEqual(['o-1']);
  });

  test('close() resolves and lists a sent Command that was never delivered as pending', async () => {
    const { inMemory, handled } = await running();
    await inMemory.sender.send('ChargeCard', charge, { factId: 'f-1' });

    await inMemory.close();

    expect(inMemory.pending).toMatchObject([{ name: 'ChargeCard@1', deliveryCount: 1 }]);
    expect(handled).toEqual([]);
  });
});
