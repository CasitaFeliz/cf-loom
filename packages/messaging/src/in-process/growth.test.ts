import { afterEach, describe, expect, test, vi } from 'vitest';
import { growthOf } from '../../../contract/test/growth.ts';
import type { BrokerConnection, DurableConsumer, OutgoingMessage, Settlement } from '../index.ts';
import { type InProcessBrokerLimits, inProcess } from './index.ts';

/** How many times longer a shape eight times as large may take: 8 for work done once per part, 64 for work that revisits parts. */
const linearGrowth = 24;

/** How many times longer a shape may take at eight times the size, when its size changes nothing. */
const flatGrowth = 4;

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

      const growth = growthOf(
        (count) => publishingAndDelivering(connection, subject, count),
        { small: 4_000, large: 32_000 },
        linearGrowth,
      );

      expect(growth).toBeLessThan(linearGrowth);
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

      const growth = growthOf(
        (others) =>
          publishingAndDelivering(connections.get(others) as BrokerConnection, subject, 1_000),
        { small: 10, large: 1_000 },
        flatGrowth,
      );

      expect(growth).toBeLessThan(flatGrowth);
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
      const growth = growthOf(
        (size) => {
          const given = limitsOf(size);
          return () => inProcess(given);
        },
        { small: 2_500, large: 20_000 },
        linearGrowth,
      );

      expect(growth).toBeLessThan(linearGrowth);
    },
    growthTimeout,
  );
});
