import { unbrokenLineOf } from '@cf-loom/contract/internal';
import type { Applied } from './applied.ts';

/** What an adapter applies, in the order the Broker plan lists it. */
export type ToApply<Stream, DurableConsumer> = {
  readonly streams: readonly Stream[];
  readonly durableConsumers: readonly DurableConsumer[];
};

/** How an adapter applies one Stream and one Durable consumer. */
export type Appliers<Stream, DurableConsumer> = {
  readonly stream: (stream: Stream) => Promise<Applied>;
  readonly durableConsumer: (durableConsumer: DurableConsumer) => Promise<Applied>;
};

/** Applies every Stream, then every Durable consumer, each in order, and stops at the first refusal, keeping what it applied. */
export async function applyInOrder<Stream, DurableConsumer>(
  toApply: ToApply<Stream, DurableConsumer>,
  appliers: Appliers<Stream, DurableConsumer>,
): Promise<Applied> {
  for (const stream of toApply.streams) {
    const applied = await appliers.stream(stream);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  for (const durableConsumer of toApply.durableConsumers) {
    const applied = await appliers.durableConsumer(durableConsumer);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  return { kind: 'applied' };
}

/** Rejects `applyBrokerPlan` with the refusal, the Broker client's error as its `cause`. */
export function throwIfRefused(applied: Applied): void {
  if (applied.kind === 'refused') {
    throw new Error(unbrokenLineOf(applied.message), { cause: applied.cause });
  }
}
