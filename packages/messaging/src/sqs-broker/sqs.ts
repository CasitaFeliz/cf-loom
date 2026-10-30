import type { SNSClient } from '@aws-sdk/client-sns';
import { type Closed, prefixedNameOf } from '@cf-loom/contract/internal';
import {
  type Broker,
  type BrokerPrefixed,
  checkedPrefixOf,
  planRemedy,
  type ServiceStream,
} from '../broker/index.ts';
import {
  accountLinesOf,
  type Place,
  placeOf,
  type SqsConnecting,
  topicArnOf,
} from './connecting.ts';
import { sqsConnectionOf } from './sqs-connection.ts';
import { isTopic } from './topic-exists.ts';

/** What `sqs()` takes: how cf-loom reaches SNS and SQS, and the Broker prefix of every name it uses on the Broker. */
export type SqsBrokerOptions = SqsConnecting & BrokerPrefixed;

/** A Broker on SNS/SQS: each `messaging()` starts only once the Service's SNS topic exists, and `consume` receives from each Durable consumer's SQS queue, through the organization's clients, which cf-loom never destroys. */
export function sqs<const Given = unknown>(options: Closed<Given, SqsBrokerOptions>): Broker {
  const prefix = checkedPrefixOf(options.prefix);
  const accountLines = accountLinesOf(options.account);
  if (accountLines.length > 0) {
    throw new Error(accountLines.join('\n'));
  }
  return {
    connect: async (serviceStream) => {
      const place = await locatedBy(options);
      const stream = prefixedNameOf(prefix, serviceStream.stream);
      await checkTopic(options.sns, serviceStream, { stream, arn: topicArnOf(place, stream) });
      return sqsConnectionOf();
    },
  };
}

async function locatedBy(connecting: SqsConnecting): Promise<Place> {
  const located = await placeOf(connecting);
  if (located.kind === 'refused') {
    throw new Error(located.lines.join('\n'));
  }
  return located.place;
}

/** Refuses a Service that publishes or sends when its Stream has no topic; one that does neither needs none. */
async function checkTopic(
  sns: SNSClient,
  serviceStream: ServiceStream,
  topic: { readonly stream: string; readonly arn: string },
): Promise<void> {
  if (serviceStream.subjects.length === 0 || (await isTopic(sns, topic.arn))) {
    return;
  }
  throw new Error(`The stream ${topic.stream} has no SNS topic ${topic.arn}: ${planRemedy}`);
}
