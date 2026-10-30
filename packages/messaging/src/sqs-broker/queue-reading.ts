import { oneLineOf, oneOrListOf } from '../broker-limits/index.ts';
import { deliveriesOf, readVisibilityTimeout } from './reading-limits.ts';
import { backoffEntriesOf, backoffTag, subscriptionTag } from './tags.ts';

/** What a queue's attributes and tags say, as they came: the values of the three attributes cf-loom asks for and the queue's tags. */
export type QueueHeld = {
  readonly attributes: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
};

/** What the queue holds that cf-loom reads: how each differs from what `applyBrokerPlan` writes, its subscription's ARN when it has one, and its waits in milliseconds and `maxReceiveCount` when it differs in neither. */
export type QueueReading = {
  readonly differences: readonly string[];
  readonly subscriptionArn: string | undefined;
  readonly read: QueueRead | undefined;
};

/** The waits of a queue's first deliveries in milliseconds and the receives its redrive allows. */
export type QueueRead = {
  readonly waits: readonly [number, ...number[]];
  readonly maxReceiveCount: number;
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
  const differences = [visibility, redrive, backoff, subscription].flatMap(differenceOf);
  const subscriptionArn = subscription.kind === 'read' ? subscription.value : undefined;
  if (visibility.kind === 'read' && redrive.kind === 'read' && backoff.kind === 'read') {
    const waits = [milliseconds(visibility.value), ...backoff.value.map(milliseconds)] as const;
    return { differences, subscriptionArn, read: { waits, maxReceiveCount: redrive.value } };
  }
  return { differences, subscriptionArn, read: undefined };
}

function milliseconds(seconds: number): number {
  return seconds * 1_000;
}

function differenceOf(read: Read<unknown>): readonly string[] {
  return read.kind === 'differs' ? [read.difference] : [];
}

function visibilityTimeoutOf(attribute: string | undefined): Read<number> {
  const seconds = attribute === undefined ? undefined : readVisibilityTimeout(`${attribute}s`);
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
    const parsed: unknown = JSON.parse(redrivePolicy);
    return typeof parsed === 'object' && parsed !== null && 'maxReceiveCount' in parsed
      ? parsed.maxReceiveCount
      : undefined;
  } catch {
    return undefined;
  }
}

function backoffOf(tag: string | undefined): Read<readonly number[]> {
  if (tag === undefined) {
    return { kind: 'read', value: [] };
  }
  const entries = oneOrListOf(readVisibilityTimeout)(backoffEntriesOf(tag));
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
