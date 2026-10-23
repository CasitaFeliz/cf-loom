import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import {
  type Consumer,
  type ConsumerInfo,
  JetStreamApiCodes,
  type JetStreamManager,
} from '@nats-io/jetstream';
import type { BrokerConsumer } from '../broker/index.ts';
import { isApiError } from './applied.ts';
import { shapeDifferencesOf } from './durable-shape.ts';
import { type Waits, waitsOf } from './in-progress.ts';

/** A consumer of the Service bound to its durable consumer on the Broker, which pulls its Messages. */
export type Binding = {
  readonly consumer: BrokerConsumer;
  readonly pulled: Consumer;
  readonly waits: Waits;
};

/** Every consumer bound, or a line for each durable consumer or stream that is not there, naming it. */
export type Bound =
  | { readonly kind: 'bound'; readonly bindings: readonly Binding[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

type Looked =
  | { readonly kind: 'bound'; readonly binding: Binding }
  | { readonly kind: 'refused'; readonly line: string };

type Asked =
  | { readonly kind: 'held'; readonly info: ConsumerInfo }
  | { readonly kind: 'missing'; readonly line: string };

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
  const asked = await askedFor(manager, stream, durable);
  if (asked.kind === 'missing') {
    return { kind: 'refused', line: asked.line };
  }
  const subject = prefixedSubjectOf(prefix, consumer.subject);
  const differences = shapeDifferencesOf(asked.info.config, subject);
  if (differences.length > 0) {
    const line = `The durable consumer ${durable} ${differences.join(' and ')}: ${apply}`;
    return { kind: 'refused', line };
  }
  const pulled = manager.jetstream().consumers.getConsumerFromInfo(asked.info);
  return { kind: 'bound', binding: { consumer, pulled, waits: waitsOf(asked.info.config) } };
}

/** What NATS holds about the durable consumer, or the line for the stream or durable consumer it says does not exist; any other error is thrown. */
async function askedFor(
  manager: JetStreamManager,
  stream: string,
  durable: string,
): Promise<Asked> {
  try {
    return { kind: 'held', info: await manager.consumers.info(stream, durable) };
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      const line = `The stream ${stream}, which the durable consumer ${durable} reads, does not exist: ${apply}`;
      return { kind: 'missing', line };
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      const line = `The durable consumer ${durable} does not exist on the stream ${stream}: ${apply}`;
      return { kind: 'missing', line };
    }
    throw error;
  }
}
