// biome-ignore-all lint/style/useNamingConvention: SNS spells its fields in PascalCase
import { PublishCommand } from '@aws-sdk/client-sns';
import { linesTextOf, prefixedSubjectOf, snsAttributesOf } from '@cf-loom/contract/internal';
import type { BrokerConnection, OutgoingMessage } from '../broker/index.ts';
import type { SqsSide } from './connecting.ts';
import { queuesFoundOf } from './queue-finding.ts';
import { receiveFrom } from './receiving.ts';
import { refusalsOf } from './refusals.ts';

/** The connection `messaging()` publishes, consumes and closes through, over the clients the Service gave. */
export function sqsConnectionOf(side: SqsSide, topicArn: string): BrokerConnection {
  const running: Promise<void>[] = [];
  const refusals = refusalsOf();
  return {
    publish: async (message) => {
      await publishOn(side, topicArn, message);
      return { duplicate: false };
    },
    consume: async (durableConsumers, { closing, troubled }) => {
      const found = await queuesFoundOf(side, durableConsumers);
      if (found.kind === 'refused') {
        throw new Error(linesTextOf(found.lines));
      }
      for (const queue of found.queues) {
        running.push(receiveFrom(queue, { sqs: side.sqs, closing, troubled, refusals }));
      }
    },
    close: async () => {
      await Promise.all(running);
      const refusal = refusals.error();
      if (refusal !== undefined) {
        throw refusal;
      }
    },
  };
}

async function publishOn(
  { sns, prefix }: SqsSide,
  topicArn: string,
  message: OutgoingMessage,
): Promise<void> {
  const subject = prefixedSubjectOf(prefix, message.subject);
  const MessageAttributes = snsAttributesOf({ ...message, subject });
  const Message = new TextDecoder().decode(message.body);
  await sns.send(new PublishCommand({ TopicArn: topicArn, Message, MessageAttributes }));
}
