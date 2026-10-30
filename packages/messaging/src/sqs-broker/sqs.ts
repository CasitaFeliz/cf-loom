import { type Closed, prefixedNameOf } from '@cf-loom/contract/internal';
import { type Broker, type BrokerPrefixed, checkedPrefixOf, planRemedy } from '../broker/index.ts';
import { placeOf, type SqsConnecting, topicArnOf } from './connecting.ts';
import { sqsConnectionOf } from './sqs-connection.ts';
import { isTopic } from './topic-exists.ts';

/** What `sqs()` takes: how cf-loom reaches SNS and SQS, and the Broker prefix of every name it uses on the Broker. */
export type SqsBrokerOptions = SqsConnecting & BrokerPrefixed;

/** A Broker on SNS/SQS: each `messaging()` starts only once the Service's SNS topic exists, and `consume` receives from each Durable consumer's SQS queue, through the organization's clients, which cf-loom never destroys. */
export function sqs<const Given = unknown>(options: Closed<Given, SqsBrokerOptions>): Broker {
  const prefix = checkedPrefixOf(options.prefix);
  return {
    connect: async (serviceStream) => {
      const located = await placeOf(options);
      if (located.kind === 'refused') {
        throw new Error(located.lines.join('\n'));
      }
      const stream = prefixedNameOf(prefix, serviceStream.stream);
      const topicArn = topicArnOf(located.place, stream);
      if (!(await isTopic(options.sns, topicArn))) {
        throw new Error(`The stream ${stream} has no SNS topic ${topicArn}: ${planRemedy}`);
      }
      return sqsConnectionOf();
    },
  };
}
