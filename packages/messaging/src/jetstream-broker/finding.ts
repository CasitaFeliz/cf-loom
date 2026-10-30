import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type ConsumerInfo, JetStreamApiCodes, type JetStreamManager } from '@nats-io/jetstream';
import type { DurableConsumer } from '../broker/index.ts';
import { isApiError } from './api-error.ts';
import { shapeDifferencesOf } from './durable-consumer-shape.ts';
import { type PullRequest, pullRequestOf } from './pull-once.ts';
import { planRemedy } from './stream-check.ts';
import { type Waits, waitsOf } from './waits.ts';

/**
 * The `DurableConsumer` handed to `consume`, with its pull request on the Broker, the waits NATS
 * gives its deliveries, and its `max_deliver` as NATS reports it, `-1` for none.
 */
export type FoundDurableConsumer = {
  readonly durableConsumer: DurableConsumer;
  readonly request: PullRequest;
  readonly waits: Waits;
  readonly maxDeliver: number;
};

/** Every Durable consumer found on the Broker, or a line for each Durable consumer or stream that is missing or not in the shape cf-loom pulls from, naming it. */
export type Found =
  | { readonly kind: 'found'; readonly durableConsumers: readonly FoundDurableConsumer[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

type Pullable =
  | { readonly kind: 'pullable'; readonly found: FoundDurableConsumer }
  | { readonly kind: 'refused'; readonly line: string };

type DurableConsumerLookup =
  | { readonly kind: 'found'; readonly consumerInfo: ConsumerInfo }
  | { readonly kind: 'missing'; readonly line: string };

/** What finding Durable consumers needs: JetStream's manager, the prefix of every name, and the prefixes a pull is addressed with. */
export type Search = {
  readonly manager: JetStreamManager;
  readonly prefix: string | null;
  readonly apiPrefix: string;
  readonly inboxPrefix: string | undefined;
};

/** Asks NATS for each Durable consumer under its prefixed name, every one before any is pulled from. */
export async function durableConsumersFoundOf(
  search: Search,
  durableConsumers: readonly DurableConsumer[],
): Promise<Found> {
  const foundDurableConsumers: FoundDurableConsumer[] = [];
  const lines: string[] = [];
  for (const durableConsumer of durableConsumers) {
    const pullable = await pullableOf(search, durableConsumer);
    if (pullable.kind === 'pullable') {
      foundDurableConsumers.push(pullable.found);
    } else {
      lines.push(pullable.line);
    }
  }
  return lines.length > 0
    ? { kind: 'refused', lines }
    : { kind: 'found', durableConsumers: foundDurableConsumers };
}

async function pullableOf(search: Search, durableConsumer: DurableConsumer): Promise<Pullable> {
  const { manager, prefix, apiPrefix, inboxPrefix } = search;
  const stream = prefixedNameOf(prefix, durableConsumer.stream);
  const durableName = prefixedNameOf(prefix, durableConsumer.durable);
  const lookup = await durableConsumerLookupOf(manager, stream, durableName);
  if (lookup.kind === 'missing') {
    return { kind: 'refused', line: lookup.line };
  }
  const { consumerInfo } = lookup;
  const subject = prefixedSubjectOf(prefix, durableConsumer.subject);
  const differences = shapeDifferencesOf(consumerInfo.config, subject);
  if (differences.length > 0) {
    const line = `The Durable consumer ${durableName} ${differences.join(' and ')}: ${planRemedy}`;
    return { kind: 'refused', line };
  }
  const request = pullRequestOf(consumerInfo, apiPrefix, inboxPrefix);
  const waits = waitsOf(consumerInfo.config);
  const maxDeliver = consumerInfo.config.max_deliver ?? -1;
  return { kind: 'pullable', found: { durableConsumer, request, waits, maxDeliver } };
}

/** What NATS holds about the Durable consumer, or the line for the stream or Durable consumer it says does not exist; any other error is thrown. */
async function durableConsumerLookupOf(
  manager: JetStreamManager,
  stream: string,
  durableName: string,
): Promise<DurableConsumerLookup> {
  try {
    return { kind: 'found', consumerInfo: await manager.consumers.info(stream, durableName) };
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      const line = `The stream ${stream}, which the Durable consumer ${durableName} reads, does not exist: ${planRemedy}`;
      return { kind: 'missing', line };
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      const line = `The Durable consumer ${durableName} does not exist on the stream ${stream}: ${planRemedy}`;
      return { kind: 'missing', line };
    }
    throw error;
  }
}
