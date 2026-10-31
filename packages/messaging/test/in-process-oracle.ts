import {
  type Answer,
  answerOf,
  type HandlerSpec,
  handlersOf,
  type Limits,
  type Run,
  type Settings,
  type Wait,
} from './in-process-draw.ts';

const millisecondsOfWait: Readonly<Record<Wait, number>> = {
  '1s': 1_000,
  '2s': 2_000,
  '5s': 5_000,
};

/** A Message the Broker took, as a run published or sent it. */
export type PublishedMessage = {
  readonly subject: string;
  readonly messageId: string;
  readonly copy: string;
  /** Whether billing-service was consuming when the Broker took it. */
  readonly billingConsuming: boolean;
};

/** A delivery a Handler is expected to receive. */
export type Expected = {
  readonly handler: string;
  readonly copy: string;
  readonly deliveryCount: number;
  readonly lastAttempt: boolean;
  readonly waitMs: number;
  readonly answer: Answer;
};

/** The settings a Durable consumer resolves to: its own over the defaults. */
export function resolvedOf(limits: Limits, durable: string): Required<Settings> {
  return { ...limits.durableConsumerDefaults, ...limits.durableConsumers[durable] };
}

/**
 * The deliveries a plain model of the Broker makes: each Message goes to every Durable consumer of its subject
 * that was consuming when it was published, delivered again after its wait until a Handler returns or ends it, or
 * until `maxDeliver` deliveries.
 */
export function expectedOf(
  run: Run,
  subjects: Readonly<Record<string, string>>,
  published: readonly PublishedMessage[],
): readonly Expected[] {
  const expected: Expected[] = [];
  for (const message of published) {
    for (const spec of handlersOf(run)) {
      const takes = subjects[spec.durable] === message.subject;
      const consuming = spec.service === 'orders-service' || message.billingConsuming;
      if (takes && consuming) {
        for (const delivery of deliveriesOf(run, spec, message)) {
          expected.push(delivery);
        }
      }
    }
  }
  return expected;
}

function deliveriesOf(run: Run, spec: HandlerSpec, message: PublishedMessage): readonly Expected[] {
  const { ackWait, maxDeliver } = resolvedOf(run.limits, spec.durable);
  const waits = ackWait.map((wait) => millisecondsOfWait[wait]);
  const { handler } = spec;
  const deliveries: Expected[] = [];
  for (let deliveryCount = 1; ; deliveryCount++) {
    const answer = answerOf(run.seed, { handler, messageId: message.messageId, deliveryCount });
    const lastAttempt = maxDeliver !== 'unlimited' && deliveryCount >= maxDeliver;
    const waitMs = waits[Math.min(deliveryCount, waits.length) - 1] ?? 0;
    deliveries.push({ handler, copy: message.copy, deliveryCount, lastAttempt, waitMs, answer });
    if (lastAttempt || answer === 'return' || answer === 'non-retryable') {
      return deliveries;
    }
  }
}
