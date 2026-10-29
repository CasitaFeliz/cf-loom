// biome-ignore-all lint/style/useNamingConvention: SNS spells its attributes in PascalCase

import { isDeepStrictEqual } from 'node:util';
import { snsSubjectAttribute } from '@cf-loom/contract/internal';

/** Every attribute that makes an SNS subscription one cf-loom reads from, so what `applyBrokerPlan` writes and what `consume` refuses cannot drift apart. */
export type SubscriptionShape = {
  readonly RawMessageDelivery: 'true';
  readonly FilterPolicy: string;
  readonly FilterPolicyScope: 'MessageAttributes';
  readonly TopicArn: string;
  readonly Endpoint: string;
};

/** One attribute of a subscription that is not the shape's, and how. */
export type SubscriptionDifference = {
  readonly attribute: keyof SubscriptionShape;
  readonly text: string;
};

/** The subscription of a queue to its Stream's topic: raw delivery, filtered on the Message's subject in its message attributes. */
export function subscriptionShapeOf(subscription: {
  readonly topicArn: string;
  readonly queueArn: string;
  readonly subject: string;
}): SubscriptionShape {
  return {
    RawMessageDelivery: 'true',
    FilterPolicy: JSON.stringify({ [snsSubjectAttribute]: [subscription.subject] }),
    FilterPolicyScope: 'MessageAttributes',
    TopicArn: subscription.topicArn,
    Endpoint: subscription.queueArn,
  };
}

/** How the attributes of an existing subscription differ from the shape; none when it is one. A filter policy is compared as JSON, and an attribute SNS does not return, as a subscription with no filter has none of the filter's two, differs. */
export function subscriptionDifferencesOf(
  attributes: Readonly<Record<string, string>>,
  shape: SubscriptionShape,
): readonly SubscriptionDifference[] {
  const names: (keyof SubscriptionShape)[] = [
    'RawMessageDelivery',
    'FilterPolicy',
    'FilterPolicyScope',
    'TopicArn',
    'Endpoint',
  ];
  return names.flatMap((attribute) => differenceOf(attribute, attributes[attribute], shape));
}

function differenceOf(
  attribute: keyof SubscriptionShape,
  held: string | undefined,
  shape: SubscriptionShape,
): readonly SubscriptionDifference[] {
  const expected = shape[attribute];
  if (isSame(attribute, held, expected)) {
    return [];
  }
  const text =
    held === undefined
      ? `has no ${attribute}, not ${expected}`
      : `has ${attribute} ${held}, not ${expected}`;
  return [{ attribute, text }];
}

function isSame(
  attribute: keyof SubscriptionShape,
  held: string | undefined,
  expected: string,
): boolean {
  if (held === undefined) {
    return false;
  }
  return attribute === 'FilterPolicy' ? isSameJson(held, expected) : held === expected;
}

function isSameJson(held: string, expected: string): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(held), JSON.parse(expected));
  } catch {
    return false;
  }
}
