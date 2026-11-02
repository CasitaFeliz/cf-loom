import { afterAll, describe, expect, test, vi } from 'vitest';
import { handlersOf, type Run, runOf } from '../../test/in-process-draw.ts';
import { type Expected, expectedOf, resolvedOf } from '../../test/in-process-oracle.ts';
import { type Observed, performRun } from '../../test/in-process-run.ts';

vi.hoisted(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

const seeds = Array.from({ length: 120 }, (_, at) => at + 1);

/** What the draws have produced so far, to assert that between them they met every case the rules act on. */
const met = new Set<string>();

type Delivered = Pick<Expected, 'handler' | 'copy' | 'deliveryCount' | 'lastAttempt'>;

const textOf = (delivered: Delivered) =>
  `${delivered.handler} ${delivered.copy} ${delivered.deliveryCount} ${delivered.lastAttempt}`;

function receivedBy(observed: Observed): string[] {
  return observed.starts.map(textOf).sort();
}

function deadlinesOf(expected: readonly Expected[]): string[] {
  return expected
    .filter(({ answer }) => answer === 'hang')
    .map(({ handler, deliveryCount, waitMs }) => `${handler} ${deliveryCount} ${waitMs}`)
    .sort();
}

/** Each delivery after the first starts no earlier than the one before it plus that delivery's wait. */
function earlyRedeliveries(observed: Observed, expected: readonly Expected[]): string[] {
  const waitOf = new Map(
    expected.map(({ handler, copy, deliveryCount, waitMs }) => [
      `${handler} ${copy} ${deliveryCount}`,
      waitMs,
    ]),
  );
  const early: string[] = [];
  for (const start of observed.starts) {
    const before = observed.starts.find(
      ({ handler, copy, deliveryCount }) =>
        handler === start.handler &&
        copy === start.copy &&
        deliveryCount === start.deliveryCount - 1,
    );
    const wait = waitOf.get(`${start.handler} ${start.copy} ${start.deliveryCount - 1}`);
    if (before !== undefined && wait !== undefined && start.at < before.at + wait) {
      early.push(`${textOf(start)} started ${before.at + wait - start.at} ms early`);
    }
  }
  return early;
}

/** Notes which cases the deliveries of this draw met: the answers, the attempts and the settings in force. */
function noteDeliveries(run: Run, expected: readonly Expected[]): void {
  for (const { answer, lastAttempt, handler } of expected) {
    met.add(`answer ${answer}`);
    met.add(lastAttempt ? 'a last attempt' : 'a delivery that is not the last');
    const durable = handlersOf(run).find((spec) => spec.handler === handler)?.durable ?? '';
    if (resolvedOf(run.limits, durable).maxDeliver === 'unlimited') {
      met.add('an unlimited Durable consumer');
    }
    if (durable in run.limits.durableConsumers) {
      met.add('a name-level override');
    }
  }
}

/** Notes which cases the Messages of this draw met: repeated Fact ids, Events nobody takes, publishes either side of the second Service's consume. */
function noteMessages(run: Run, observed: Observed): void {
  const { published, subjects } = observed;
  const messageIds = published.map(({ messageId }) => messageId);
  if (new Set(messageIds).size < messageIds.length) {
    met.add('a repeated Fact id');
  }
  if (run.subscriptionCounts.includes(2)) {
    met.add('an Event with two Subscriptions');
  }
  if (published.some(({ subject }) => !Object.values(subjects).includes(subject))) {
    met.add('a Message no Durable consumer takes');
  }
  const billing = handlersOf(run).filter(({ service }) => service === 'billing-service');
  const billingSubjects = billing.map(({ durable }) => subjects[durable]);
  for (const { subject, billingConsuming } of published) {
    if (billingSubjects.includes(subject)) {
      met.add(
        billingConsuming
          ? 'a publish after the second Service consumed'
          : 'a publish before the second Service consumed',
      );
    }
  }
}

describe('inProcess() over drawn runs, against a plain model of the Broker', () => {
  test.each(seeds)(
    'seed %i: each Handler receives the model’s deliveries, one at a time, no earlier than their waits, and nothing once every timer has run',
    async (seed) => {
      const run = runOf(seed);

      const observed = await performRun(run);

      const expected = expectedOf(run, observed.subjects, observed.published);
      noteDeliveries(run, expected);
      noteMessages(run, observed);
      expect(Object.keys(observed.subjects).sort()).toEqual(
        handlersOf(run)
          .map(({ durable }) => durable)
          .sort(),
      );
      expect(receivedBy(observed)).toEqual(expected.map(textOf).sort());
      expect(
        observed.deadlines
          .map(({ handler, deliveryCount, waitMs }) => `${handler} ${deliveryCount} ${waitMs}`)
          .sort(),
      ).toEqual(deadlinesOf(expected));
      expect(observed.mostAtOnce).toBeLessThanOrEqual(1);
      expect(earlyRedeliveries(observed, expected)).toEqual([]);
      expect([observed.timersLeft, observed.startsAfterDrain]).toEqual([0, 0]);
      expect(observed.duplicates).toEqual(observed.published.map(() => false));
    },
  );

  test('the draws met every case the rules act on', () => {
    expect([...met].sort()).toEqual(
      [
        'a delivery that is not the last',
        'a last attempt',
        'a name-level override',
        'a Message no Durable consumer takes',
        'a publish after the second Service consumed',
        'a publish before the second Service consumed',
        'a repeated Fact id',
        'an Event with two Subscriptions',
        'an unlimited Durable consumer',
        'answer hang',
        'answer non-retryable',
        'answer retryable',
        'answer return',
        'answer throw',
      ].sort(),
    );
  });
});
