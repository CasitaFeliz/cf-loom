import { linesTextOf } from '@cf-loom/contract/internal';
import type { BrokerConnection } from '../broker/index.ts';
import { type DurableConsumersRead, durableConsumersResolvedOf } from '../broker-limits/index.ts';
import type { HeldDurableConsumers } from './held.ts';
import { durableConsumerLimits, type durableConsumerReaders } from './reading-limits.ts';

/** One `messaging()`'s connection to the Broker inside the process: it publishes to the Durable consumers of a subject, and pulls from those it consumes. */
export function inProcessConnectionOf(
  held: HeldDurableConsumers,
  limits: DurableConsumersRead<typeof durableConsumerReaders>,
): BrokerConnection {
  return {
    publish: async (message) => {
      for (const durableConsumer of held.durableConsumersOf(message.subject)) {
        durableConsumer.lineUp(message);
      }
      return { duplicate: false };
    },
    consume: async (durableConsumers, run) => {
      const listed = durableConsumers.map(
        (durableConsumer) => [durableConsumer.durable, durableConsumer] as const,
      );
      const resolving = durableConsumersResolvedOf(listed, limits, durableConsumerLimits);
      if (resolving.lines.length > 0) {
        throw new Error(linesTextOf(resolving.lines));
      }
      if (run.closing.aborted) {
        return;
      }
      for (const { durableConsumer, limits: resolved } of resolving.planned) {
        held.heldFor(durableConsumer, resolved).pull(durableConsumer.receive, run.closing);
      }
    },
    close: async () => {},
  };
}
