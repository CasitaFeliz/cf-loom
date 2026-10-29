// biome-ignore-all lint/style/useNamingConvention: SNS spells its attributes and fields in PascalCase
import {
  GetSubscriptionAttributesCommand,
  ListSubscriptionsByTopicCommand,
  SetSubscriptionAttributesCommand,
  type SNSClient,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import { type SubscriptionShape, subscriptionDifferencesOf } from './subscription-shape.ts';

type Listed = { readonly arn: string; readonly protocol: string; readonly endpoint: string };

/** The subscriptions cf-loom makes on SNS, which lists each topic's once for every queue subscribed to it. */
export type Subscribing = {
  /** Subscribes the shape's queue to its topic, or makes the subscription it has the shape; answers its ARN. */
  readonly subscribe: (shape: SubscriptionShape) => Promise<string>;
};

/** Subscribes through `sns`; a topic's subscriptions are listed at the first queue subscribed to it and shared by the others, since listing is limited to 30 requests a second. */
export function subscribingOn(sns: SNSClient): Subscribing {
  const listings = new Map<string, Promise<readonly Listed[]>>();
  const listingOf = (topicArn: string): Promise<readonly Listed[]> => {
    const held = listings.get(topicArn) ?? listAll(sns, topicArn);
    listings.set(topicArn, held);
    return held;
  };
  return {
    subscribe: async (shape) => {
      const listed = await listingOf(shape.TopicArn);
      const found = listed.find((subscription) => isOfQueue(subscription, shape));
      if (found === undefined) {
        return await create(sns, shape);
      }
      await restore(sns, found.arn, shape);
      return found.arn;
    },
  };
}

function isOfQueue(subscription: Listed, shape: SubscriptionShape): boolean {
  return subscription.protocol === 'sqs' && subscription.endpoint === shape.Endpoint;
}

async function listAll(sns: SNSClient, topicArn: string): Promise<readonly Listed[]> {
  const subscriptions: Listed[] = [];
  let next: string | undefined;
  do {
    const page = await sns.send(
      new ListSubscriptionsByTopicCommand({ TopicArn: topicArn, NextToken: next }),
    );
    for (const subscription of page.Subscriptions ?? []) {
      const {
        SubscriptionArn: arn = '',
        Protocol: protocol = '',
        Endpoint: endpoint = '',
      } = subscription;
      subscriptions.push({ arn, protocol, endpoint });
    }
    next = page.NextToken;
  } while (next !== undefined);
  return subscriptions;
}

async function create(sns: SNSClient, shape: SubscriptionShape): Promise<string> {
  const { TopicArn, Endpoint, ...attributes } = shape;
  const subscribed = await sns.send(
    new SubscribeCommand({
      TopicArn,
      Protocol: 'sqs',
      Endpoint,
      Attributes: attributes,
      ReturnSubscriptionArn: true,
    }),
  );
  return subscribed.SubscriptionArn ?? '';
}

async function restore(sns: SNSClient, arn: string, shape: SubscriptionShape): Promise<void> {
  const read = await sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: arn }));
  for (const { attribute } of subscriptionDifferencesOf(read.Attributes ?? {}, shape)) {
    await sns.send(
      new SetSubscriptionAttributesCommand({
        SubscriptionArn: arn,
        AttributeName: attribute,
        AttributeValue: shape[attribute],
      }),
    );
  }
}
