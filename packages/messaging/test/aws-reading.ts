// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import {
  GetSubscriptionAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListTopicsCommand,
  type SNSClient,
} from '@aws-sdk/client-sns';
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  ListQueueTagsCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { snsSubjectAttribute } from '@cf-loom/contract/internal';

function lastSegmentOf(text: string, separator: string): string {
  return text.slice(text.lastIndexOf(separator) + 1);
}

/** The names of the topics that exist, sorted. */
export async function topicNamesOf(sns: SNSClient): Promise<string[]> {
  const listed = await sns.send(new ListTopicsCommand({}));
  const arns = (listed.Topics ?? []).map((topic) => topic.TopicArn ?? '');
  return arns.map((arn) => lastSegmentOf(arn, ':')).sort();
}

/** The names of the queues that exist, sorted. */
export async function queueNamesOf(sqs: SQSClient): Promise<string[]> {
  const listed = await sqs.send(new ListQueuesCommand({ MaxResults: 1000 }));
  return (listed.QueueUrls ?? []).map((url) => lastSegmentOf(url, '/')).sort();
}

/** The URL of the queue named `name`. */
export async function queueUrlOf(sqs: SQSClient, name: string): Promise<string> {
  const found = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
  return found.QueueUrl ?? '';
}

/** Every attribute SQS holds for the queue named `name`. */
export async function queueAttributesOf(
  sqs: SQSClient,
  name: string,
): Promise<Record<string, string>> {
  const QueueUrl = await queueUrlOf(sqs, name);
  const read = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['All'] }));
  return read.Attributes ?? {};
}

/** The tags of the queue named `name`. */
export async function queueTagsOf(sqs: SQSClient, name: string): Promise<Record<string, string>> {
  const QueueUrl = await queueUrlOf(sqs, name);
  const read = await sqs.send(new ListQueueTagsCommand({ QueueUrl }));
  return read.Tags ?? {};
}

/** The subscriptions of a topic: each one's ARN and the queue it delivers to. */
export async function subscriptionsOf(
  sns: SNSClient,
  topicArn: string,
): Promise<{ readonly arn: string; readonly endpoint: string; readonly protocol: string }[]> {
  const listed = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }));
  return (listed.Subscriptions ?? []).map((subscription) => ({
    arn: subscription.SubscriptionArn ?? '',
    endpoint: subscription.Endpoint ?? '',
    protocol: subscription.Protocol ?? '',
  }));
}

/** Every attribute SNS holds for a subscription. */
export async function subscriptionAttributesOf(
  sns: SNSClient,
  subscriptionArn: string,
): Promise<Record<string, string>> {
  const read = await sns.send(
    new GetSubscriptionAttributesCommand({ SubscriptionArn: subscriptionArn }),
  );
  return read.Attributes ?? {};
}

/** The bodies waiting in the queue named `name`, and the subject each carries. */
export async function receivedFrom(
  sqs: SQSClient,
  name: string,
): Promise<{ readonly body: string; readonly subject: string | undefined }[]> {
  const QueueUrl = await queueUrlOf(sqs, name);
  const received = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl,
      MaxNumberOfMessages: 10,
      MessageAttributeNames: ['All'],
    }),
  );
  return (received.Messages ?? []).map((message) => ({
    body: message.Body ?? '',
    subject: message.MessageAttributes?.[snsSubjectAttribute]?.StringValue,
  }));
}
