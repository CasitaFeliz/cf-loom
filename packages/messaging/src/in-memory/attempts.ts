import type { Command, Event } from '@cf-loom/contract';
import {
  brokerMessageIdOf,
  isCommand,
  isSubscription,
  jsonBytesOf,
  messageIdentityOf,
} from '@cf-loom/contract/internal';
import { InvalidInputError } from '@cf-loom/handlers';
import { writtenMessageBody } from '@cf-loom/handlers/internal';
import type { BrokerConsumer, Delivery } from '../broker/index.ts';
import { consumerDetailsOf } from '../consuming/index.ts';
import {
  headerPartsOf,
  InvalidMessageError,
  type InvalidPart,
  idPartsOf,
  sizePartsOf,
} from '../sending/index.ts';
import type { DeliveryMeta } from './types.ts';

/** One delivery to one consumer: the Delivery it receives. */
export type Attempt = { readonly consumer: BrokerConsumer; readonly delivery: Delivery };

/** The Delivery of a Message the first time a consumer receives it. */
export function firstDeliveryOf({
  messageId,
  factId,
  headers,
  body,
}: Omit<Delivery, 'deliveryCount' | 'lastAttempt'>): Delivery {
  return { messageId, factId, deliveryCount: 1, lastAttempt: false, headers, body };
}

/** What a test hands `deliver`: the Message Version, its body as a Subscriber reads it, and its meta. */
type Injection = {
  readonly message: Event | Command;
  readonly body: unknown;
  readonly meta: DeliveryMeta;
};

/**
 * The Delivery of an injected Message to each consumer it reaches, in the order `consume` gave
 * them, checked all together so that a body one Reader refuses delivers nothing.
 */
export function injectedAttemptsOf(
  consumers: readonly BrokerConsumer[],
  injection: Injection,
): readonly Attempt[] {
  return attemptsOf(reachedBy(consumers, injection.message), injection);
}

/** The consumers a Message Version reaches: a Command's CommandHandler, or the Subscriptions to an Event. */
function reachedBy(
  consumers: readonly BrokerConsumer[],
  message: Event | Command,
): readonly BrokerConsumer[] {
  const reached = consumers.filter((consumer) => consumes(consumer, message));
  if (reached.length === 0) {
    const named = messageIdentityOf(message.name, message.version);
    const reason = 'nothing consume()d takes it, or its Handler is a stub';
    throw new Error(`${named} has no consumer: ${reason}`);
  }
  return reached;
}

function attemptsOf(
  reached: readonly BrokerConsumer[],
  { message, body, meta }: Injection,
): readonly Attempt[] {
  const factId = meta.factId ?? globalThis.crypto.randomUUID();
  const messageId = meta.messageId ?? brokerMessageIdOf(message, factId);
  const { headers, invalid: refusedHeaders } = headerPartsOf(meta.headers ?? {});
  const parts = { messageId, factId, headers };
  const invalid: InvalidPart[] = [
    ...givenIdPartsOf(meta),
    ...refusedHeaders,
    ...sizePartsOf(message, parts),
  ];
  if (invalid.length > 0) {
    throw new InvalidMessageError(invalid);
  }
  return reached.map((consumer) => {
    const bytes = jsonBytesOf(writtenBodyOf(consumer, body));
    return { consumer, delivery: firstDeliveryOf({ ...parts, body: bytes }) };
  });
}

/** The ids a test gave that would not arrive as given; a random one, or one derived from an accepted Fact id, always does. */
function givenIdPartsOf({ factId, messageId }: DeliveryMeta): readonly InvalidPart[] {
  return [
    ...(factId === undefined ? [] : idPartsOf('factId', factId)),
    ...(messageId === undefined ? [] : idPartsOf('messageId', messageId)),
  ];
}

function consumes(consumer: BrokerConsumer, message: Event | Command): boolean {
  const { element } = consumerDetailsOf(consumer);
  if (isCommand(message)) {
    return element === message;
  }
  return isSubscription(element) && element.event === message;
}

/** The body as it travels to a consumer, written back through its Reader; one that breaks it throws as a direct call does. */
function writtenBodyOf(consumer: BrokerConsumer, body: unknown): unknown {
  const { element, reader } = consumerDetailsOf(consumer);
  const written = writtenMessageBody(reader, body);
  if (written.kind === 'issues') {
    throw new InvalidInputError(element, written.issues);
  }
  return written.value;
}
