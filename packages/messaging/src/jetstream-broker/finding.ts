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

type FoundInfo =
  | { readonly kind: 'found'; readonly info: ConsumerInfo }
  | { readonly kind: 'missing'; readonly line: string };

/** Asks NATS for the prefixed durable consumer of each consumer, every one before any is pulled from. */
export async function durablesFoundOf(
  manager: JetStreamManager,
  prefix: string | null,
  consumers: readonly BrokerConsumer[],
): Promise<Found> {
  const durables: FoundDurable[] = [];
  const lines: string[] = [];
  for (const consumer of consumers) {
    const pullable = await pullableOf(manager, prefix, consumer);
    if (pullable.kind === 'pullable') {
      durables.push(pullable.durable);
    } else {
      lines.push(pullable.line);
    }
  }
  return lines.length > 0 ? { kind: 'refused', lines } : { kind: 'found', durables };
}

async function pullableOf(
  manager: JetStreamManager,
  prefix: string | null,
  consumer: BrokerConsumer,
): Promise<Pullable> {
  const stream = prefixedNameOf(prefix, consumer.stream);
  const durable = prefixedNameOf(prefix, consumer.durable);
  const found = await foundInfoOf(manager, stream, durable);
  if (found.kind === 'missing') {
    return { kind: 'refused', line: found.line };
  }
  const subject = prefixedSubjectOf(prefix, consumer.subject);
  const differences = shapeDifferencesOf(found.info.config, subject);
  if (differences.length > 0) {
    const line = `The durable consumer ${durable} ${differences.join(' and ')}: ${planRemedy}`;
    return { kind: 'refused', line };
  }
  const request = pullRequestOf(found.info, manager);
  return { kind: 'pullable', durable: { consumer, request, waits: waitsOf(found.info.config) } };
}

/** What NATS holds about the durable consumer, or the line for the stream or durable consumer it says does not exist; any other error is thrown. */
async function foundInfoOf(
  manager: JetStreamManager,
  stream: string,
  durable: string,
): Promise<FoundInfo> {
  try {
    return { kind: 'found', info: await manager.consumers.info(stream, durable) };
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      const line = `The stream ${stream}, which the durable consumer ${durable} reads, does not exist: ${planRemedy}`;
      return { kind: 'missing', line };
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      const line = `The durable consumer ${durable} does not exist on the stream ${stream}: ${planRemedy}`;
      return { kind: 'missing', line };
    }
    throw error;
  }
}
