import type { Command, Event } from '@cf-loom/contract';
import {
  isCommand,
  isSubscription,
  jsonBytesOf,
  messageIdentityOf,
} from '@cf-loom/contract/internal';
import { InvalidInputError } from '@cf-loom/handlers';
import { defaultedMetaOf, firstAttempt, writtenMessageBody } from '@cf-loom/handlers/internal';
import type { Delivery } from '../broker/index.ts';
import type { CoreDurableConsumer } from '../consuming/index.ts';
import { checkedHeadersOf, InvalidMessageError } from '../sending/index.ts';
import type { DeliveryMeta } from './types.ts';

/** One delivery to one Durable consumer: the Delivery it receives. */
export type Attempt = {
  readonly durableConsumer: CoreDurableConsumer;
  readonly delivery: Delivery;
};

/** The Delivery of a Message the first time a Durable consumer receives it, with no wait: memory models no broker configuration. */
export function firstDeliveryOf({
  messageId,
  factId,
  headers,
  body,
}: Omit<Delivery, 'deliveryCount' | 'lastAttempt' | 'waitMs'>): Delivery {
  const first = { ...firstAttempt, waitMs: undefined };
  return { messageId, factId, ...first, headers, body };
}

/** What a test hands `deliver`: the Message Version, its body as a Subscriber reads it, and its meta. */
type Injection = {
  readonly message: Event | Command;
  readonly body: unknown;
  readonly meta: DeliveryMeta;
};

/**
 * The Delivery of an injected Message to each Durable consumer it reaches, in the order `consume` gave
 * them, checked all together so that a body one Reader refuses delivers nothing.
 */
export function injectedAttemptsOf(
  durableConsumers: readonly CoreDurableConsumer[],
  injection: Injection,
): readonly Attempt[] {
  return attemptsOf(reachedBy(durableConsumers, injection.message), injection);
}

/** The Durable consumers a Message Version reaches: a Command's Message Handler, or the Subscriptions to an Event. */
function reachedBy(
  durableConsumers: readonly CoreDurableConsumer[],
  message: Event | Command,
): readonly CoreDurableConsumer[] {
  const reached = durableConsumers.filter((durableConsumer) => consumes(durableConsumer, message));
  if (reached.length === 0) {
    const named = messageIdentityOf(message.name, message.version);
    const reason = 'nothing consume()d takes it, or its Handler is a Stub';
    throw new Error(`${named} has no Durable consumer: ${reason}`);
  }
  return reached;
}

function attemptsOf(
  reached: readonly CoreDurableConsumer[],
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
  return reached.map((durableConsumer) => {
    const bytes = jsonBytesOf(writtenBodyOf(durableConsumer, body));
    return { durableConsumer, delivery: firstDeliveryOf({ ...parts, body: bytes }) };
  });
}

function consumes({ declaration }: CoreDurableConsumer, message: Event | Command): boolean {
  if (isCommand(message)) {
    return declaration === message;
  }
  return isSubscription(declaration) && declaration.event === message;
}

/** The body as it travels to a Durable consumer, written back through its Reader; one that breaks it throws as a direct call does. */
function writtenBodyOf({ declaration, reader }: CoreDurableConsumer, body: unknown): unknown {
  const written = writtenMessageBody(reader, body);
  if (written.kind === 'issues') {
    throw new InvalidInputError(declaration, written.issues);
  }
  return written.value;
}
