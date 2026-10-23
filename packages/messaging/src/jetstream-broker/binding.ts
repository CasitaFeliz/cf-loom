import { prefixedNameOf } from '@cf-loom/contract/internal';
import type { Consumer, JetStreamManager } from '@nats-io/jetstream';
import type { BrokerConsumer } from '../broker/index.ts';

/** A consumer of the Service bound to its durable consumer on the Broker, which pulls its Messages. */
export type Binding = { readonly consumer: BrokerConsumer; readonly pulled: Consumer };

/** Asks NATS for the prefixed durable consumer of each consumer, every one before any is pulled. */
export async function bindingsOf(
  manager: JetStreamManager,
  prefix: string | null,
  consumers: readonly BrokerConsumer[],
): Promise<readonly Binding[]> {
  const bindings: Binding[] = [];
  for (const consumer of consumers) {
    const stream = prefixedNameOf(prefix, consumer.stream);
    const info = await manager.consumers.info(stream, prefixedNameOf(prefix, consumer.durable));
    const pulled = manager.jetstream().consumers.getConsumerFromInfo(info);
    bindings.push({ consumer, pulled });
  }
  return bindings;
}
