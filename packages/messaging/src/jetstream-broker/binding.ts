import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type Consumer, JetStreamApiCodes, type JetStreamManager } from '@nats-io/jetstream';
import type { BrokerConsumer } from '../broker/index.ts';
import { isApiError } from './applied.ts';
import { shapeDifferencesOf } from './durable-shape.ts';

/** A consumer of the Service bound to its durable consumer on the Broker, which pulls its Messages. */
export type Binding = { readonly consumer: BrokerConsumer; readonly pulled: Consumer };

/** Every consumer bound, or a line for each durable consumer or stream that is not there, naming it. */
export type Bound =
  | { readonly kind: 'bound'; readonly bindings: readonly Binding[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

type Looked =
  | { readonly kind: 'bound'; readonly binding: Binding }
  | { readonly kind: 'refused'; readonly line: string };

const apply = "apply the Service's broker plan";

/** Asks NATS for the prefixed durable consumer of each consumer, every one before any is pulled. */
export async function bindingsOf(
  manager: JetStreamManager,
  prefix: string | null,
  consumers: readonly BrokerConsumer[],
): Promise<Bound> {
  const bindings: Binding[] = [];
  const lines: string[] = [];
  for (const consumer of consumers) {
    const looked = await lookedUp(manager, prefix, consumer);
    if (looked.kind === 'bound') {
      bindings.push(looked.binding);
    } else {
      lines.push(looked.line);
    }
  }
  return lines.length > 0 ? { kind: 'refused', lines } : { kind: 'bound', bindings };
}

async function lookedUp(
  manager: JetStreamManager,
  prefix: string | null,
  consumer: BrokerConsumer,
): Promise<Looked> {
  const stream = prefixedNameOf(prefix, consumer.stream);
  const durable = prefixedNameOf(prefix, consumer.durable);
  try {
    const info = await manager.consumers.info(stream, durable);
    const differences = shapeDifferencesOf(
      info.config,
      prefixedSubjectOf(prefix, consumer.subject),
    );
    if (differences.length > 0) {
      const line = `The durable consumer ${durable} ${differences.join(' and ')}: ${apply}`;
      return { kind: 'refused', line };
    }
    const pulled = manager.jetstream().consumers.getConsumerFromInfo(info);
    return { kind: 'bound', binding: { consumer, pulled } };
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      const line = `The stream ${stream}, which the durable consumer ${durable} reads, does not exist: ${apply}`;
      return { kind: 'refused', line };
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      const line = `The durable consumer ${durable} does not exist on the stream ${stream}: ${apply}`;
      return { kind: 'refused', line };
    }
    throw error;
  }
}
