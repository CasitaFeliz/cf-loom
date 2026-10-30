import {
  brokerMessageIdHeader,
  byCodePoint,
  factIdHeader,
  snsFactIdAttribute,
  snsHeadersAttribute,
  snsMessageIdAttribute,
  snsSubjectAttribute,
} from '@cf-loom/contract/internal';
import { componentRefOf, type JsonSchema } from '../json-schema/index.ts';
import type { AsyncApiBroker } from './wire.ts';

/** The name of the component that describes the broker headers every Message travels with. */
export const brokerHeadersName = 'BrokerHeaders';

/** The reference every message makes to the broker headers. */
export const brokerHeadersRef: JsonSchema = componentRefOf(brokerHeadersName);

/** The broker headers every Message travels with on the wire of a Broker. */
export function brokerHeadersSchemaOf(broker: AsyncApiBroker): JsonSchema {
  switch (broker) {
    case 'jetstream':
      return jetstreamBrokerHeaders;
    case 'sqs':
      return snsBrokerHeaders;
  }
}

/** The broker headers of a Message on JetStream: its two ids, which are required, and the transport headers, which are not described. */
const jetstreamBrokerHeaders: JsonSchema = {
  type: 'object',
  required: [factIdHeader, brokerMessageIdHeader],
  properties: {
    [factIdHeader]: {
      type: 'string',
      minLength: 1,
      description: 'The Fact id: every Message one publish call sends for the same fact shares it',
    },
    [brokerMessageIdHeader]: {
      type: 'string',
      minLength: 1,
      description:
        'The broker message id, event.<Name>.v<version>:<Fact id>, which the Broker deduplicates by',
    },
  },
  additionalProperties: {
    type: 'string',
    description:
      'Any other header; transport headers are those outside the `Cf-Loom-` and `Nats-` namespaces',
  },
};

const snsAttributes: Readonly<Record<string, JsonSchema>> = {
  [snsFactIdAttribute]: {
    type: 'string',
    minLength: 1,
    description:
      'The Fact id, which every Message one publish call sends for the same fact shares, as a JSON string, quotes included, in ASCII JSON',
  },
  [snsHeadersAttribute]: {
    type: 'string',
    minLength: 1,
    contentMediaType: 'application/json',
    description:
      'The Transport headers, a JSON object of strings, {} when there are none, in ASCII JSON',
  },
  [snsMessageIdAttribute]: {
    type: 'string',
    minLength: 1,
    description:
      'The Broker message id, event.<Name>.v<version>:<Fact id>, as a JSON string, quotes included, in ASCII JSON',
  },
  [snsSubjectAttribute]: {
    type: 'string',
    minLength: 1,
    description:
      "The subject with the Broker prefix in front, as is: the channel's address, which an SNS subscription's filter policy matches",
  },
};

const snsProperties = Object.fromEntries(
  Object.entries(snsAttributes).toSorted(([left], [right]) => byCodePoint(left, right)),
);

/** The broker headers of a Message on SNS/SQS: the four message attributes the adapter sends and no other, all required, in code point order of their names. */
const snsBrokerHeaders: JsonSchema = {
  type: 'object',
  required: Object.keys(snsProperties),
  properties: snsProperties,
  additionalProperties: false,
};
