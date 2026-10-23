import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type ConsumerInfo, JetStreamApiCodes, type JetStreamManager } from '@nats-io/jetstream';
import type { BrokerConsumer } from '../broker/index.ts';
import { isApiError } from './applied.ts';
import { shapeDifferencesOf } from './durable-shape.ts';
import { type Waits, waitsOf } from './in-progress.ts';
import { type PullRequest, pullRequestOf } from './pull-once.ts';
import { planRemedy } from './stream-check.ts';

/** A consumer of the Service with the durable consumer on the Broker its Messages are pulled from, and the waits NATS gives its deliveries. */
export type FoundDurable = {
  readonly consumer: BrokerConsumer;
  readonly request: PullRequest;
  readonly waits: Waits;
};

/** Every consumer's durable consumer found, or a line for each durable consumer or stream that is missing or not in the shape cf-loom pulls from, naming it. */
export type Found =
  | { readonly kind: 'found'; readonly durables: readonly FoundDurable[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

type Pullable =
  | { readonly kind: 'pullable'; readonly durable: FoundDurable }
  | { readonly kind: 'refused'; readonly line: string };

type DurableLookup =
  | { readonly kind: 'found'; readonly consumerInfo: ConsumerInfo }
  | { readonly kind: 'missing'; readonly line: string };

/** What finding durable consumers needs: JetStream's manager, the prefix of every name, and the prefixes a pull is addressed with. */
export type Search = {
  readonly manager: JetStreamManager;
  readonly prefix: string | null;
  readonly apiPrefix: string;
  readonly inboxPrefix: string | undefined;
};

/** Asks NATS for the prefixed durable consumer of each consumer, every one before any is pulled from. */
export async function durablesFoundOf(
  search: Search,
  consumers: readonly BrokerConsumer[],
): Promise<Found> {
  const durables: FoundDurable[] = [];
  const lines: string[] = [];
  for (const consumer of consumers) {
    const pullable = await pullableOf(search, consumer);
    if (pullable.kind === 'pullable') {
      durables.push(pullable.durable);
    } else {
      lines.push(pullable.line);
    }
  }
  return lines.length > 0 ? { kind: 'refused', lines } : { kind: 'found', durables };
}

async function pullableOf(search: Search, consumer: BrokerConsumer): Promise<Pullable> {
  const { manager, prefix, apiPrefix, inboxPrefix } = search;
  const stream = prefixedNameOf(prefix, consumer.stream);
  const durableName = prefixedNameOf(prefix, consumer.durable);
  const lookup = await durableLookupOf(manager, stream, durableName);
  if (lookup.kind === 'missing') {
    return { kind: 'refused', line: lookup.line };
  }
  const { consumerInfo } = lookup;
  const subject = prefixedSubjectOf(prefix, consumer.subject);
  const differences = shapeDifferencesOf(consumerInfo.config, subject);
  if (differences.length > 0) {
    const line = `The durable consumer ${durableName} ${differences.join(' and ')}: ${planRemedy}`;
    return { kind: 'refused', line };
  }
  const request = pullRequestOf(consumerInfo, apiPrefix, inboxPrefix);
  const waits = waitsOf(consumerInfo.config);
  return { kind: 'pullable', durable: { consumer, request, waits } };
}

/** What NATS holds about the durable consumer, or the line for the stream or durable consumer it says does not exist; any other error is thrown. */
async function durableLookupOf(
  manager: JetStreamManager,
  stream: string,
  durableName: string,
): Promise<DurableLookup> {
  try {
    return { kind: 'found', consumerInfo: await manager.consumers.info(stream, durableName) };
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      const line = `The stream ${stream}, which the durable consumer ${durableName} reads, does not exist: ${planRemedy}`;
      return { kind: 'missing', line };
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      const line = `The durable consumer ${durableName} does not exist on the stream ${stream}: ${planRemedy}`;
      return { kind: 'missing', line };
    }
    throw error;
  }
}
