import { linesTextOf } from '@cf-loom/contract/internal';
import type { BrokerConnection, DeliveryLimits, DurableConsumer } from '../broker/index.ts';
import type { HeldDurableConsumers } from './held.ts';
import { type ReadLimits, resolvedLimitsOf } from './reading-limits.ts';

/** A Durable consumer `consume` was handed, with the limits its name resolves to. */
type Resolved = { readonly durableConsumer: DurableConsumer; readonly limits: DeliveryLimits };

/** Every Durable consumer's limits resolved, or one line for each whose limits leave a setting unset. */
type Resolving =
  | { readonly kind: 'resolved'; readonly resolved: readonly Resolved[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** One `messaging()`'s connection to the Broker inside the process: it publishes to the Durable consumers of a subject, and pulls from those it consumes. */
export function inProcessConnectionOf(
  held: HeldDurableConsumers,
  limits: ReadLimits,
): BrokerConnection {
  return {
    publish: async (message) => {
      for (const durableConsumer of held.durableConsumersOf(message.subject)) {
        durableConsumer.lineUp(message);
      }
      return { duplicate: false };
    },
    consume: async (durableConsumers, run) => {
      const resolving = resolvingOf(durableConsumers, limits);
      if (resolving.kind === 'refused') {
        throw new Error(linesTextOf(resolving.lines));
      }
      if (run.closing.aborted) {
        return;
      }
      for (const { durableConsumer, limits: resolved } of resolving.resolved) {
        held.heldFor(durableConsumer, resolved).pull(durableConsumer.receive, run.closing);
      }
    },
    close: async () => {},
  };
}

/** Resolves every Durable consumer's limits before any is pulled from. */
function resolvingOf(durableConsumers: readonly DurableConsumer[], limits: ReadLimits): Resolving {
  const resolved: Resolved[] = [];
  const lines: string[] = [];
  for (const durableConsumer of durableConsumers) {
    const resolving = resolvedLimitsOf(limits, durableConsumer.durable);
    if (resolving.kind === 'unset') {
      lines.push(resolving.line);
    } else {
      resolved.push({ durableConsumer, limits: resolving.limits });
    }
  }
  return lines.length > 0 ? { kind: 'refused', lines } : { kind: 'resolved', resolved };
}
