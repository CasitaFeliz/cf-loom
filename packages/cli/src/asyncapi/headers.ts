import { brokerMessageIdHeader, factIdHeader } from '@cf-loom/contract/internal';
import { componentRefOf, type JsonSchema } from '../json-schema/index.ts';

/** The name of the component that describes the broker headers every Message travels with. */
export const brokerHeadersName = 'BrokerHeaders';

/** The reference every message makes to the broker headers. */
export const brokerHeadersRef: JsonSchema = componentRefOf(brokerHeadersName);

/** The broker headers of a Message: its two ids, which are required, and the transport headers, which are not described. */
export const brokerHeaders: JsonSchema = {
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
        'The broker message id, <event|command>.<Name>.v<version>:<Fact id>, which the Broker deduplicates by',
    },
  },
  additionalProperties: {
    type: 'string',
    description:
      'Any other header; transport headers are those outside the `Cf-Loom-` and `Nats-` namespaces',
  },
};
