import type { ConsumerInfo } from '@nats-io/jetstream';
import { createInbox, type Msg, millis, type NatsConnection, nanos } from '@nats-io/nats-core';
import { type PulledMessage, pulledMessageOf } from './pulled-message.ts';

/** The longest a pull waits for a Message, which nats.js's pulls wait too. */
const longestExpiryMs = 30_000;

/** How many expiries a pull waits for an answer before it is sent again. */
const lateFactor = 2;

/** What a pull of one Message asks of a durable consumer: where, which inbox prefix its reply comes back on, and how long it waits for a Message. */
export type PullRequest = {
  readonly subject: string;
  readonly inboxPrefix: string | undefined;
  readonly expiryMs: number;
};

/** What one pull came back with: a Message, none because it expired or stopped, or a failure. */
export type Pull =
  | { readonly kind: 'message'; readonly message: PulledMessage }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

const none: Pull = { kind: 'none' };

const failed: Pull = { kind: 'failed' };

/** The request that pulls one Message from a durable consumer, which expires within its `max_expires` and after 30 seconds at most. */
export function pullRequestOf(
  consumerInfo: ConsumerInfo,
  apiPrefix: string,
  inboxPrefix: string | undefined,
): PullRequest {
  const { stream_name: stream, name } = consumerInfo;
  const maxExpires = consumerInfo.config.max_expires;
  const maxExpiryMs = maxExpires === undefined ? 0 : millis(maxExpires);
  return {
    subject: `${apiPrefix}.CONSUMER.MSG.NEXT.${stream}.${name}`,
    inboxPrefix,
    expiryMs: maxExpiryMs > 0 ? Math.min(longestExpiryMs, maxExpiryMs) : longestExpiryMs,
  };
}

/**
 * Pulls one Message on a subscription of its own. When `stopping` aborts, the subscription is drained
 * and not unsubscribed, so a Message the Broker had already sent still arrives, and the caller hands it back.
 */
export async function pullOnce(
  request: PullRequest,
  natsConnection: NatsConnection,
  stopping: AbortSignal,
): Promise<Pull> {
  try {
    return await requested(request, natsConnection, stopping);
  } catch {
    return failed;
  }
}

async function requested(
  request: PullRequest,
  natsConnection: NatsConnection,
  stopping: AbortSignal,
): Promise<Pull> {
  const pull = Promise.withResolvers<Pull>();
  const inbox = createInbox(request.inboxPrefix);
  const subscription = natsConnection.subscribe(inbox, {
    callback: (error, message) => pull.resolve(error === null ? pullOf(message, inbox) : failed),
  });
  const drain = () => subscription.drain().catch(() => undefined);
  const late = setTimeout(() => pull.resolve(none), request.expiryMs * lateFactor);
  stopping.addEventListener('abort', drain);
  void subscription.closed.then(() => pull.resolve(none));
  try {
    const wanted = JSON.stringify({ batch: 1, expires: nanos(request.expiryMs) });
    natsConnection.publish(request.subject, wanted, { reply: inbox });
    return await pull.promise;
  } finally {
    clearTimeout(late);
    stopping.removeEventListener('abort', drain);
    if (!subscription.isClosed() && !subscription.isDraining()) {
      subscription.unsubscribe();
    }
  }
}

function pullOf(message: Msg, inbox: string): Pull {
  if (message.subject !== inbox) {
    return { kind: 'message', message: pulledMessageOf(message) };
  }
  const code = message.headers?.code;
  return code === 404 || code === 408 ? none : failed;
}
