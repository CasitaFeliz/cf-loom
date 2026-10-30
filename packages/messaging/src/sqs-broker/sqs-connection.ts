// biome-ignore-all lint/style/useNamingConvention: SNS spells its fields in PascalCase
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { prefixedSubjectOf, snsAttributesOf } from '@cf-loom/contract/internal';
import type { BrokerConnection, OutgoingMessage } from '../broker/index.ts';
import type { Place } from './connecting.ts';
import { queuesFoundOf } from './queue-finding.ts';
import { receiveFrom } from './receiving.ts';

/** What a connection works with: the clients of the Service, the place they are in and the Broker prefix of every name. */
export type Working = {
  readonly sns: SNSClient;
  readonly sqs: SQSClient;
  readonly place: Place;
  readonly prefix: string | null;
};

/** The connection `messaging()` publishes, consumes and closes through, over the clients the Service gave. */
export function sqsConnectionOf(working: Working, topicArn: string): BrokerConnection {
  const running: Promise<void>[] = [];
  return {
    publish: async (message) => {
      await publishOn(working, topicArn, message);
      return { duplicate: false };
    },
    consume: async (durableConsumers, { closing, troubled }) => {
      const found = await queuesFoundOf(working, durableConsumers);
      if (found.kind === 'refused') {
        throw new Error(found.lines.join('\n'));
      }
      for (const queue of found.queues) {
        running.push(receiveFrom(queue, { sqs: working.sqs, closing, troubled }));
      }
    },
    close: async () => {
      await Promise.all(running);
    },
  };
}

async function publishOn(
  { sns, prefix }: Working,
  topicArn: string,
  message: OutgoingMessage,
): Promise<void> {
  const subject = prefixedSubjectOf(prefix, message.subject);
  const attributes = snsAttributesOf({ ...message, subject });
  const MessageAttributes = Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      { DataType: 'String', StringValue: value },
    ]),
  );
  const Message = new TextDecoder().decode(message.body);
  await sns.send(new PublishCommand({ TopicArn: topicArn, Message, MessageAttributes }));
}
