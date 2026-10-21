import type { Command, Event } from '@cf-loom/contract';
import {
  brokerMessageIdOf,
  isCommand,
  isSubscription,
  messageIdentityOf,
} from '@cf-loom/contract/internal';
import { InvalidInputError } from '@cf-loom/handlers';
import { writtenMessageBody } from '@cf-loom/handlers/internal';
import type { BrokerConsumer, Delivery } from '../broker/index.ts';
import { factIdOf, jsonBytesOf, transportHeadersOf } from '../sending/index.ts';
import type { DeliveryMeta } from './types.ts';

/** One delivery to one consumer: the Delivery it receives. */
export type Attempt = { readonly consumer: BrokerConsumer; readonly delivery: Delivery };

/** What a test hands `deliver`: the Message Version, its body as a Subscriber reads it, and its meta. */
export type Injection = {
  readonly message: Event | Command;
  readonly body: unknown;
  readonly meta: DeliveryMeta;
};

/** The consumers a Message Version reaches, in the order `consume` gave them: a Command's CommandHandler, or the Subscriptions to an Event. */
export function reachedBy(
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

/** The Delivery of an injected Message to each consumer it reaches, checked all together so that a body one Reader refuses delivers nothing. */
export function attemptsOf(
  reached: readonly BrokerConsumer[],
  { message, body, meta }: Injection,
): readonly Attempt[] {
  const factId = factIdOf(meta.factId);
  const messageId = meta.messageId ?? brokerMessageIdOf(message, factId);
  const headers = transportHeadersOf(meta.headers ?? {});
  return reached.map((consumer) => {
    const bytes = jsonBytesOf(writtenBodyOf(consumer, body));
    return { consumer, delivery: { messageId, factId, deliveryCount: 1, headers, body: bytes } };
  });
}

function consumes(consumer: BrokerConsumer, message: Event | Command): boolean {
  if (isCommand(message)) {
    return consumer.element === message;
  }
  return isSubscription(consumer.element) && consumer.element.event === message;
}

/** The body as it travels to a consumer, written back through its Reader; one that breaks it throws as a direct call does. */
function writtenBodyOf(consumer: BrokerConsumer, body: unknown): unknown {
  const written = writtenMessageBody(consumer.reader, body);
  if (written.kind === 'issues') {
    throw new InvalidInputError(consumer.element, written.issues);
  }
  return written.value;
}
