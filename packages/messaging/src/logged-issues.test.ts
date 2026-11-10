import { defineEvent, defineGroup, defineService, defineSubscription } from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { printedBy } from '../../contract/test/printed.ts';
import {
  type Broker,
  type ConsumedFault,
  type DurableConsumer,
  type MessagingOptions,
  messaging,
} from './index.ts';

const body = z.object({
  items: z.array(z.string()),
  byKey: z.record(z.string(), z.array(z.string())),
});

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: body.partial(),
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
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const readers = readersOf({
  commands: {},
  subscriptions: { notifyOnCreated: { declaration: notifyOnCreated, reader: body.partial() } },
});

const handlers = {
  commands: {},
  subscriptions: {
    notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, () => undefined),
  },
  readers,
};

const source = 'notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1 attempt 1';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A messaging consuming `notifyOnCreated`, and a way to deliver it a body as the Broker would. */
async function consuming(options: MessagingOptions = {}) {
  const durableConsumers: DurableConsumer[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async () => ({ duplicate: false }),
      consume: async (given) => {
        for (const durableConsumer of given) {
          durableConsumers.push(durableConsumer);
        }
      },
      close: async () => undefined,
    }),
  };
  const { consume } = await messaging(contract, broker, options);
  await consume(handlers, {});
  const deliver = (delivered: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(delivered));
    const meta = { messageId: 'm-1', factId: 'f-1', deliveryCount: 1, lastAttempt: false };
    return durableConsumers[0]?.receive({ ...meta, waitMs: undefined, headers: {}, body: bytes });
  };
  return { deliver };
}

describe('messaging: the console lists an ended Message’s Issues', () => {
  test('an ended Message of 1,000 invalid items logs its first 100 Issues and one line counting the other 900', async () => {
    const printed = printedBy('error');
    const { deliver } = await consuming();

    await deliver({ items: Array(1_000).fill(1) });

    const firstHundred = Array.from({ length: 100 }, (_, index) =>
      expect.stringContaining(`${source}: body.items.${index} invalid_type: `),
    );
    expect(printed).toEqual([...firstHundred, `${source}: 900 more Issues`]);
  });

  test('an ended Message whose Issues each hold a 100 kB key logs only the line counting them', async () => {
    const printed = printedBy('error');
    const { deliver } = await consuming();

    await deliver({ byKey: { ['k'.repeat(100_000)]: Array(1_000).fill(1) } });

    expect(printed).toEqual([`${source}: 1000 more Issues`]);
  });

  test('with onServiceFault, the hook receives every Issue and the console nothing', async () => {
    const printed = printedBy('error');
    const faults: ConsumedFault[] = [];
    const { deliver } = await consuming({ onServiceFault: (fault) => void faults.push(fault) });

    await deliver({ items: Array(1_000).fill(1) });

    expect(faults).toMatchObject([{ kind: 'invalid-body' }]);
    expect(faults[0]?.kind === 'invalid-body' && faults[0].issues).toHaveLength(1_000);
    expect(printed).toEqual([]);
  });
});
