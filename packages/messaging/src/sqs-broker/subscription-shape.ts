// biome-ignore-all lint/style/useNamingConvention: SNS spells its attributes in PascalCase
import { isDeepStrictEqual } from 'node:util';
import { snsSubjectAttribute } from '@cf-loom/contract/internal';

/** The attributes of a subscription that `SetSubscriptionAttributes` sets and cf-loom requires. */
export type SubscriptionAttributes = {
  readonly RawMessageDelivery: 'true';
  readonly FilterPolicy: string;
  readonly FilterPolicyScope: 'MessageAttributes';
};

/** What makes an SNS subscription one cf-loom reads from, so what `applyBrokerPlan` writes and what `consume` refuses cannot drift apart: the topic and the queue it joins, and its attributes. */
export type SubscriptionShape = {
  readonly topicArn: string;
  readonly endpoint: string;
  readonly attributes: SubscriptionAttributes;
};

/** One attribute of a subscription that is not the shape's, and how. */
export type SubscriptionDifference = {
  readonly attribute: keyof SubscriptionAttributes;
  readonly text: string;
};

/** A queue joining the topic of its Durable consumer's Stream, for the Messages of one subject. */
export type QueueOnTopic = {
  readonly topicArn: string;
  readonly queueArn: string;
  readonly subject: string;
};

/** The subscription of a queue to its Stream's topic: raw delivery, filtered on the Message's subject in its message attributes. */
export function subscriptionShapeOf({
  topicArn,
  queueArn,
  subject,
}: QueueOnTopic): SubscriptionShape {
  return {
    topicArn,
    endpoint: queueArn,
    attributes: {
      RawMessageDelivery: 'true',
      FilterPolicy: JSON.stringify({ [snsSubjectAttribute]: [subject] }),
      FilterPolicyScope: 'MessageAttributes',
    },
  };
}

type Compare = (held: string, expected: string) => boolean;

function isSameText(held: string, expected: string): boolean {
  return held === expected;
}

function isSameJson(held: string, expected: string): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(held), JSON.parse(expected));
  } catch {
    return false;
  }
}

/** Every attribute of the shape, with how an attribute SNS holds is compared to it. */
const comparers = {
  RawMessageDelivery: isSameText,
  FilterPolicy: isSameJson,
  FilterPolicyScope: isSameText,
} satisfies Record<keyof SubscriptionAttributes, Compare>;

function isAttribute(name: string): name is keyof SubscriptionAttributes {
  return Object.hasOwn(comparers, name);
}

/** How the attributes of an existing subscription differ from the shape's; none when they are the shape's. An attribute SNS does not return, as a subscription with no filter has none of the filter's two, differs. */
export function subscriptionDifferencesOf(
  held: Readonly<Record<string, string>>,
  shape: SubscriptionShape,
): readonly SubscriptionDifference[] {
  return Object.keys(comparers)
    .filter(isAttribute)
    .filter((attribute) => !matchesShape(attribute, held[attribute], shape))
    .map((attribute) => ({ attribute, text: differenceTextOf(attribute, held[attribute], shape) }));
}

function matchesShape(
  attribute: keyof SubscriptionAttributes,
  held: string | undefined,
  shape: SubscriptionShape,
): boolean {
  return held !== undefined && comparers[attribute](held, shape.attributes[attribute]);
}

function differenceTextOf(
  attribute: keyof SubscriptionAttributes,
  held: string | undefined,
  shape: SubscriptionShape,
): string {
  return differenceText(attribute, held, shape.attributes[attribute]);
}

function differenceText(name: string, held: string | undefined, expected: string): string {
  return held === undefined
    ? `has no ${name}, not ${expected}`
    : `has ${name} ${held}, not ${expected}`;
}

/** How an existing subscription differs from the shape: first the topic it is on and the queue it delivers to, then each attribute; none when it is the shape's. */
export function subscriptionMismatchesOf(
  held: Readonly<Record<string, string>>,
  shape: SubscriptionShape,
): readonly string[] {
  const identity = [
    ['TopicArn', shape.topicArn],
    ['Endpoint', shape.endpoint],
  ] as const;
  const identityDifferences = identity
    .filter(([name, expected]) => held[name] !== expected)
    .map(([name, expected]) => differenceText(name, held[name], expected));
  const attributeDifferences = subscriptionDifferencesOf(held, shape).map(({ text }) => text);
  return [...identityDifferences, ...attributeDifferences];
}
