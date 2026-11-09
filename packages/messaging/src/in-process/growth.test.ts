import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { orderOf, orders } from '../../../contract/test/growth.ts';
import type { BrokerConnection, DurableConsumer, OutgoingMessage, Settlement } from '../index.ts';
import { type InProcessBrokerLimits, inProcess } from './index.ts';

const growthTimeout = 240_000;

const limits = { durableConsumerDefaults: { ackWait: '30s', maxDeliver: 3 } } as const;

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const subjectOf = (at: number) => `orders-service.command.Charge${at}.v1`;

/** A Message of the Command at this number, as a Broker takes it. */
function aMessageOn(subject: string): OutgoingMessage {
  const body = new TextEncoder().encode('{"orderId":"o-1"}');
  return { subject, messageId: 'command.Charge.v1:f-1', factId: 'f-1', headers: {}, body };
}

/** A Promise-like that settles the moment `then` is called, so a hand-out settles within the call that makes it and a test can time all of it. */
function settledAtOnce(settlement: Settlement): Promise<Settlement> {
  const then = (onSettled: (settled: Settlement) => void) => void onSettled(settlement);
  return { then } as unknown as Promise<Settlement>;
}

function aDurableConsumerOn(subject: string, durable: string): DurableConsumer {
  const receive = () => settledAtOnce('acked');
  return { durable, stream: 'orders-service', subject, receive };
}

/** A connection consuming one Durable consumer of the subject and `others` more on subjects of their own. */
async function consumingOn(subject: string, others: number): Promise<BrokerConnection> {
  const connection = await inProcess(limits).connect({ stream: 'orders-service', subjects: [] });
  const all = Array.from({ length: others }, (_, at) =>
    aDurableConsumerOn(subjectOf(at + 1), `orders-service_other${at}`),
  );
  await connection.consume([aDurableConsumerOn(subject, 'orders-service_target'), ...all], {
    closing: new AbortController().signal,
    troubled: () => undefined,
  });
  return connection;
}

/** A connection consuming the Durable consumer after `cycles` connections consumed it and closed. */
async function consumingAfter(subject: string, cycles: number): Promise<BrokerConnection> {
  const broker = inProcess(limits);
  const durableConsumer = aDurableConsumerOn(subject, 'orders-service_target');
  for (let cycle = 0; cycle < cycles; cycle++) {
    const connection = await broker.connect({ stream: 'orders-service', subjects: [] });
    const closing = new AbortController();
    await connection.consume([durableConsumer], {
      closing: closing.signal,
      troubled: () => undefined,
    });
    closing.abort();
    await connection.close();
  }
  const connection = await broker.connect({ stream: 'orders-service', subjects: [] });
  const open = { closing: new AbortController().signal, troubled: () => undefined };
  await connection.consume([durableConsumer], open);
  return connection;
}

/** Publishes `count` Messages to the connection and delivers them all, each to a Handler that acknowledges at once. */
function publishingAndDelivering(connection: BrokerConnection, subject: string, count: number) {
  const message = aMessageOn(subject);
  return () => {
    for (let published = 0; published < count; published++) {
      void connection.publish(message);
    }
    vi.runAllTimers();
  };
}

describe('the growth of inProcess()', () => {
  test(
    'lining up and delivering Messages to one Durable consumer grows linearly with their number',
    async () => {
      vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'], loopLimit: 1_000_000 });
      const subject = subjectOf(0);
      const connection = await consumingOn(subject, 0);

      const order = orderOf(
        (count) => publishingAndDelivering(connection, subject, count),
        { small: 4_000, large: 32_000 },
        orders.linear,
      );

      expect(order).toBeLessThan(orders.linear);
    },
    growthTimeout,
  );

  test(
    'a publish takes as long with a thousand Durable consumers on other subjects as with ten',
    async () => {
      vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'], loopLimit: 1_000_000 });
      const subject = subjectOf(0);
      const connections = new Map([
        [10, await consumingOn(subject, 10)],
        [1_000, await consumingOn(subject, 1_000)],
      ]);

      const order = orderOf(
        (others) =>
          publishingAndDelivering(connections.get(others) as BrokerConnection, subject, 1_000),
        { small: 10, large: 1_000 },
        orders.flat,
      );

      expect(order).toBeLessThan(orders.flat);
    },
    growthTimeout,
  );

  test(
    'a publish takes as long after a thousand consume and close cycles as after ten',
    async () => {
      vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'], loopLimit: 1_000_000 });
      const subject = subjectOf(0);
      const connections = new Map([
        [10, await consumingAfter(subject, 10)],
        [1_000, await consumingAfter(subject, 1_000)],
      ]);

      const order = orderOf(
        (cycles) =>
          publishingAndDelivering(connections.get(cycles) as BrokerConnection, subject, 1_000),
        { small: 10, large: 1_000 },
        orders.flat,
      );

      expect(order).toBeLessThan(orders.flat);
    },
    growthTimeout,
  );

  test.each([
    [
      'the entries of an ack wait list',
      (size: number): InProcessBrokerLimits => ({
        durableConsumerDefaults: {
          ackWait: Array.from({ length: size }, () => '1s'),
          maxDeliver: 1,
        },
      }),
    ],
    [
      'the names under durableConsumers',
      (size: number): InProcessBrokerLimits => ({
        durableConsumers: Object.fromEntries(
          Array.from({ length: size }, (_, at) => [
            `orders-service_n${at}`,
            { ackWait: '1s', maxDeliver: 1 },
          ]),
        ),
      }),
    ],
  ] as const)(
    'reading the limits grows linearly with %s',
    (_, limitsOf) => {
      const order = orderOf(
        (size) => {
          const given = limitsOf(size);
          return () => inProcess(given);
        },
        { small: 2_500, large: 20_000 },
        orders.linear,
      );

      expect(order).toBeLessThan(orders.linear);
    },
    growthTimeout,
  );
});

setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

/** The bytes the heap and the buffers hold more after draining `count` Messages of a kilobyte than before, with the garbage collected, and the connection that is kept alive until then. */
async function retainedAfterDraining(count: number) {
  vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'], loopLimit: 10_000_000 });
  const subject = subjectOf(0);
  const connection = await consumingOn(subject, 0);
  collectGarbage();
  const before = process.memoryUsage();
  for (let published = 0; published < count; published++) {
    const body = new Uint8Array(1_024);
    void connection.publish({ ...aMessageOn(subject), body });
  }
  vi.runAllTimers();
  collectGarbage();
  collectGarbage();
  const after = process.memoryUsage();
  const retained = after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers;
  return { retained, connection };
}

describe('what inProcess() keeps of the Messages it delivered', () => {
  test('after draining 40,000 Messages of a kilobyte, far less than their bodies is held', async () => {
    const count = 40_000;

    const { retained, connection } = await retainedAfterDraining(count);

    expect(retained).toBeLessThan((count * 1_024) / 20);
    expect(connection.publish).toBeTypeOf('function');
  });
});
