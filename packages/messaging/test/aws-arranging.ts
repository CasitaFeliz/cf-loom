// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import {
  CreateTopicCommand,
  PublishCommand,
  SetSubscriptionAttributesCommand,
  type SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  type SQSClient,
  TagQueueCommand,
  UntagQueueCommand,
} from '@aws-sdk/client-sqs';
import { snsSubjectAttribute } from '@cf-loom/contract/internal';
import { queueUrlOf } from './aws-reading.ts';

/** Creates a topic as the organization's tooling would, and answers its ARN. */
export async function arrangeTopic(sns: SNSClient, name: string): Promise<string> {
  const created = await sns.send(new CreateTopicCommand({ Name: name }));
  return created.TopicArn ?? '';
}

/** Publishes a body on a topic with the subject in the `cf-loom-subject` attribute, as the adapter will. */
export async function publishOn(
  sns: SNSClient,
  topicArn: string,
  message: { readonly subject: string; readonly body: string },
): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: message.body,
      MessageAttributes: {
        [snsSubjectAttribute]: { DataType: 'String', StringValue: message.subject },
      },
    }),
  );
}

/** Creates a queue as the organization's tooling would, with the attributes and tags given. */
export async function arrangeQueue(
  sqs: SQSClient,
  name: string,
  settings: {
    readonly attributes?: Record<string, string>;
    readonly tags?: Record<string, string>;
  } = {},
): Promise<void> {
  await sqs.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: settings.attributes,
      tags: settings.tags,
    }),
  );
}

/** Sets attributes on the queue named `name`, as the organization's tooling would. */
export async function setQueueAttributes(
  sqs: SQSClient,
  name: string,
  attributes: Record<string, string>,
): Promise<void> {
  const QueueUrl = await queueUrlOf(sqs, name);
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl, Attributes: attributes }));
}

/** A raw Message as a test stores it: its body, and the message attributes it carries. */
export type RawMessage = {
  readonly body: string;
  readonly attributes?: Readonly<
    Record<string, { readonly DataType: string; readonly StringValue?: string }>
  >;
};

/** Puts a Message into the queue named `name`, as a Message already stored in it, with the message attributes it is given; answers its SQS MessageId. */
export async function storeIn(
  sqs: SQSClient,
  name: string,
  stored: string | RawMessage,
): Promise<string> {
  const QueueUrl = await queueUrlOf(sqs, name);
  const { body, attributes = {} } = typeof stored === 'string' ? { body: stored } : stored;
  const sent = await sqs.send(
    new SendMessageCommand({ QueueUrl, MessageBody: body, MessageAttributes: { ...attributes } }),
  );
  return sent.MessageId ?? '';
}

/** Subscribes a queue to a topic with no attribute, as the organization's tooling would, and answers the subscription's ARN. */
export async function subscribeByHand(
  sns: SNSClient,
  subscription: { readonly topicArn: string; readonly queueArn: string },
): Promise<string> {
  const subscribed = await sns.send(
    new SubscribeCommand({
      TopicArn: subscription.topicArn,
      Protocol: 'sqs',
      Endpoint: subscription.queueArn,
      ReturnSubscriptionArn: true,
    }),
  );
  return subscribed.SubscriptionArn ?? '';
}

/** Removes a subscription, as the organization's tooling would. */
export async function unsubscribe(sns: SNSClient, subscriptionArn: string): Promise<void> {
  await sns.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
}

/** Sets one attribute of a subscription, as the organization's tooling would. */
export async function setSubscriptionAttribute(
  sns: SNSClient,
  subscriptionArn: string,
  attribute: { readonly name: string; readonly value: string },
): Promise<void> {
  await sns.send(
    new SetSubscriptionAttributesCommand({
      SubscriptionArn: subscriptionArn,
      AttributeName: attribute.name,
      AttributeValue: attribute.value,
    }),
  );
}

/** Tags the queue named `name`, as the organization's tooling would. */
export async function tagByHand(
  sqs: SQSClient,
  name: string,
  tags: Record<string, string>,
): Promise<void> {
  const QueueUrl = await queueUrlOf(sqs, name);
  await sqs.send(new TagQueueCommand({ QueueUrl, Tags: tags }));
}

/** Puts one raw Message into each queue named, so a long poll open on it returns at once; after `closing` aborted, the adapter hands it back unread. */
export async function wakeEach(sqs: SQSClient, queues: readonly string[]): Promise<void> {
  for (const queue of queues) {
    await storeIn(sqs, queue, 'wake');
  }
}

/** Deletes the queue named `name`, as the organization's tooling would. */
export async function dropQueue(sqs: SQSClient, name: string): Promise<void> {
  const QueueUrl = await queueUrlOf(sqs, name);
  await sqs.send(new DeleteQueueCommand({ QueueUrl }));
}

/** Removes tags from the queue named `name`, as the organization's tooling would. */
export async function untagByHand(
  sqs: SQSClient,
  name: string,
  keys: readonly string[],
): Promise<void> {
  const QueueUrl = await queueUrlOf(sqs, name);
  await sqs.send(new UntagQueueCommand({ QueueUrl, TagKeys: [...keys] }));
}
