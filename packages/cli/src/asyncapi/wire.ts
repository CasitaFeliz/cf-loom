import { prefixedNameOf, streamNameOf } from '@cf-loom/contract/internal';
import type { AsyncApiObject } from './objects.ts';

/** The Brokers whose wire an AsyncAPI document can describe: the JetStream adapter's and the SNS/SQS adapter's. */
export type AsyncApiBroker = 'jetstream' | 'sqs';

/** Whether a text names a Broker whose wire an AsyncAPI document can describe. */
export function isAsyncApiBroker(text: string): text is AsyncApiBroker {
  return text === 'jetstream' || text === 'sqs';
}

/** The wire an AsyncAPI document describes: the Broker, and the prefix in front of its subjects and names, if one is given. */
export type AsyncApiWire = {
  readonly broker: AsyncApiBroker;
  readonly prefix: string | null;
};

/** The bindings of every channel of a Service on the wire: none on JetStream, on SNS/SQS the SNS topic, which is the Stream's name that `broker-plan` prints. */
export function channelBindingsOf(wire: AsyncApiWire, service: string): AsyncApiObject | undefined {
  switch (wire.broker) {
    case 'jetstream':
      return undefined;
    case 'sqs': {
      const name = prefixedNameOf(wire.prefix, streamNameOf(service));
      return { sns: { name, bindingVersion: '0.1.0' } };
    }
  }
}
