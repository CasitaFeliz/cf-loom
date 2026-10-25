import type { Command, Event } from '@cf-loom/contract';
import {
  isCommand,
  isSubscription,
  jsonBytesOf,
  messageIdentityOf,
} from '@cf-loom/contract/internal';
import { InvalidInputError } from '@cf-loom/handlers';
import { defaultedMetaOf, writtenMessageBody } from '@cf-loom/handlers/internal';
import type { BrokerConsumer, Delivery } from '../broker/index.ts';
import { consumerDetailsOf } from '../consuming/index.ts';
import { checkedHeadersOf, InvalidMessageError } from '../sending/index.ts';
import type { DeliveryMeta } from './types.ts';

/** One delivery to one consumer: the Delivery it receives. */
export type Attempt = { readonly consumer: BrokerConsumer; readonly delivery: Delivery };

/** The Delivery of a Message the first time a consumer receives it, with no wait: memory models no broker configuration. */
export function firstDeliveryOf({
  messageId,
  factId,
  headers,
  body,
}: Omit<Delivery, 'deliveryCount' | 'lastAttempt' | 'waitMs'>): Delivery {
  const first = { deliveryCount: 1, lastAttempt: false, waitMs: undefined };
  return { messageId, factId, ...first, headers, body };
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
  const { headers: given = {}, ...ids } = meta;
  const { factId, messageId } = defaultedMetaOf(message, ids);
  const measured = [{ version: message, messageId, factId }];
  const { headers, invalid } = checkedHeadersOf(ids, given, measured);
  if (invalid.length > 0) {
    throw new InvalidMessageError(invalid);
  }
  const parts = { messageId, factId, headers };
  return reached.map((consumer) => {
    const bytes = jsonBytesOf(writtenBodyOf(consumer, body));
    return { consumer, delivery: firstDeliveryOf({ ...parts, body: bytes }) };
  });
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
