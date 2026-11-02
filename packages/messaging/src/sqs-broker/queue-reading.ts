import { ownOf } from '@cf-loom/contract/internal';
import type { DeliveryWaits } from '../broker/index.ts';
import { oneLineOf, oneOrListOf } from '../broker-limits/index.ts';
import { deliveriesOf, readWait } from './reading-limits.ts';
import { backoffEntriesOf, backoffTag, subscriptionTag } from './tags.ts';

/** What a queue's attributes and tags say, as they came: the values of the three attributes cf-loom asks for and the queue's tags. */
export type QueueHeld = {
  readonly attributes: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
};

/** What the queue holds that cf-loom reads, found as `applyBrokerPlan` writes it: its waits in milliseconds, its `maxReceiveCount` and its subscription's ARN; or how it differs, with the subscription's ARN when it has one. */
export type QueueReading =
  | {
      readonly kind: 'read';
      readonly waits: DeliveryWaits;
      readonly maxReceiveCount: number;
      readonly subscriptionArn: string;
    }
  | {
      readonly kind: 'differs';
      readonly differences: readonly string[];
      readonly subscriptionArn: string | undefined;
    };

type Read<Value> =
  | { readonly kind: 'read'; readonly value: Value }
  | { readonly kind: 'differs'; readonly difference: string };

/** Reads the queue by the rules `applyBrokerPlan` writes it with: whole seconds under 12 hours for each wait, a redrive with its `maxReceiveCount`, and its subscription's ARN. */
export function queueReadingOf({ attributes, tags }: QueueHeld): QueueReading {
  const visibility = visibilityTimeoutOf(attributes['VisibilityTimeout']);
  const redrive = maxReceiveCountOf(attributes['RedrivePolicy']);
  const backoff = backoffOf(tags[backoffTag]);
  const subscription = subscriptionArnOf(tags[subscriptionTag]);
  if (
    visibility.kind === 'read' &&
    redrive.kind === 'read' &&
    backoff.kind === 'read' &&
    subscription.kind === 'read'
  ) {
    const waits = [milliseconds(visibility.value), ...backoff.value.map(milliseconds)] as const;
    return {
      kind: 'read',
      waits,
      maxReceiveCount: redrive.value,
      subscriptionArn: subscription.value,
    };
  }
  const differences = [visibility, redrive, backoff, subscription]
    .filter(isDifference)
    .map(({ difference }) => difference);
  const subscriptionArn = subscription.kind === 'read' ? subscription.value : undefined;
  return { kind: 'differs', differences, subscriptionArn };
}

function milliseconds(seconds: number): number {
  return seconds * 1_000;
}

function isDifference(read: Read<unknown>): read is Extract<Read<unknown>, { kind: 'differs' }> {
  return read.kind === 'differs';
}

function visibilityTimeoutOf(attribute: string | undefined): Read<number> {
  const seconds = attribute === undefined ? undefined : readWait(`${attribute}s`);
  if (seconds === undefined) {
    const shown = oneLineOf(attribute);
    return {
      kind: 'differs',
      difference: `has the VisibilityTimeout ${shown}, which cf-loom cannot read`,
    };
  }
  return { kind: 'read', value: seconds };
}

function maxReceiveCountOf(redrivePolicy: string | undefined): Read<number> {
  if (redrivePolicy === undefined) {
    return { kind: 'differs', difference: 'has no RedrivePolicy' };
  }
  const count = deliveriesOf(maxReceiveCountIn(redrivePolicy));
  if (count === undefined) {
    const shown = oneLineOf(redrivePolicy);
    return {
      kind: 'differs',
      difference: `has the RedrivePolicy ${shown}, whose maxReceiveCount cf-loom cannot read`,
    };
  }
  return { kind: 'read', value: count };
}

/** The `maxReceiveCount` a redrive policy's JSON holds, or `undefined` when it is no JSON object with one. */
function maxReceiveCountIn(redrivePolicy: string): unknown {
  try {
    return ownOf(JSON.parse(redrivePolicy), 'maxReceiveCount');
  } catch {
    return undefined;
  }
}

function backoffOf(tag: string | undefined): Read<readonly number[]> {
  if (tag === undefined) {
    return { kind: 'read', value: [] };
  }
  const entries = oneOrListOf(readWait)(backoffEntriesOf(tag));
  if (entries === undefined) {
    return {
      kind: 'differs',
      difference: `has the ${backoffTag} tag ${oneLineOf(tag)}, which cf-loom cannot read`,
    };
  }
  return { kind: 'read', value: entries };
}

function subscriptionArnOf(tag: string | undefined): Read<string> {
  return tag === undefined
    ? { kind: 'differs', difference: `has no ${subscriptionTag} tag` }
    : { kind: 'read', value: tag };
}
