import { brokerHeadersOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type JetStreamOptions, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import { headers, type NatsConnection } from '@nats-io/nats-core';
import type { NatsConnectionImpl } from '@nats-io/nats-core/internal';
import type { BrokerConnection, OutgoingMessage } from '../broker/index.ts';
import { durablesFoundOf } from './finding.ts';
import { pullFrom } from './pulling.ts';
import { managerOf } from './stream-check.ts';

/** The connection `messaging()` publishes, consumes and closes through, over the NATS connection the Service opened. */
export function jetStreamConnectionOf(
  natsConnection: NatsConnection,
  prefix: string | null,
  options: JetStreamOptions | undefined,
): BrokerConnection {
  const client = jetStreamClientOf(natsConnection, options);
  return {
    publish: async (message) => {
      const subject = prefixedSubjectOf(prefix, message.subject);
      const ack = await client.publish(subject, message.body, { headers: natsHeadersOf(message) });
      return { duplicate: ack.duplicate };
    },
    consume: async (consumers, { closing, troubled }) => {
      const manager = await managerOf(natsConnection, options);
      const inboxPrefix = inboxPrefixOf(natsConnection);
      const search = { manager, prefix, apiPrefix: client.apiPrefix, inboxPrefix };
      const found = await durablesFoundOf(search, consumers);
      if (found.kind === 'refused') {
        throw new Error(found.lines.join('\n'));
      }
      const stopping = AbortSignal.any([closing, closedSignalOf(natsConnection)]);
      for (const durable of found.durables) {
        void pullFrom(durable, natsConnection, { stopping, troubled });
      }
    },
    close: async () => {
      const ended = await drainOrClose(natsConnection);
      if (ended.kind === 'unanswered') {
        throw unansweredDrainError(ended.cause);
      }
    },
  };
}

/** How a connection cf-loom ended came to be closed: by its drain or by the Service, or by nats.js under a drain NATS did not answer. */
export type Ended =
  | { readonly kind: 'closed' }
  | { readonly kind: 'unanswered'; readonly cause: unknown };

/**
 * Ends a connection the Service opened by draining it, or by flushing it while the Service drains it, and
 * resolves once it is closed, whoever closed it. NATS did not answer when nats.js rejects the drain, which
 * leaves the connection open and is closed here, or, before it answers, closes the connection with an error
 * or reports a `disconnect`.
 */
export async function drainOrClose(natsConnection: NatsConnection): Promise<Ended> {
  if (natsConnection.isClosed()) {
    return { kind: 'closed' };
  }
  const dropped = droppedBeforeClosed(natsConnection);
  const answer = answerOf(
    natsConnection.isDraining() ? natsConnection.flush() : natsConnection.drain(),
  );
  const first = await Promise.race([answer, closedUnder(natsConnection)]);
  switch (first.kind) {
    case 'answered':
      await natsConnection.closed();
      return { kind: 'closed' };
    case 'rejected':
      await natsConnection.close();
      return { kind: 'unanswered', cause: first.cause };
    case 'closed-under':
      return first.why !== undefined || (await dropped)
        ? { kind: 'unanswered', cause: first.why }
        : { kind: 'closed' };
  }
}

/** The error `close()` and `apply` reject with when the drain was not answered, NATS's error as `cause` when it gave one. */
export function unansweredDrainError(cause: unknown): Error {
  return new Error('NATS did not answer the drain, so the connection was closed without it', {
    cause,
  });
}

type Answer =
  | { readonly kind: 'answered' }
  | { readonly kind: 'rejected'; readonly cause: unknown };

function answerOf(asked: Promise<void>): Promise<Answer> {
  return asked.then(
    () => ({ kind: 'answered' }),
    (cause: unknown) => ({ kind: 'rejected', cause }),
  );
}

/** The connection closed while the drain or the flush was still pending, with why nats.js says it closed. */
async function closedUnder(
  natsConnection: NatsConnection,
): Promise<{ readonly kind: 'closed-under'; readonly why: Error | undefined }> {
  const why = await natsConnection.closed();
  return { kind: 'closed-under', why: why ?? undefined };
}

/** Whether nats.js reported a `disconnect` before the connection closed, as it does before closing a connection it does not reconnect. */
async function droppedBeforeClosed(natsConnection: NatsConnection): Promise<boolean> {
  let dropped = false;
  for await (const status of natsConnection.status()) {
    if (status.type === 'disconnect') {
      dropped = true;
    }
  }
  return dropped;
}

/** A signal that aborts when the connection closes, so a pause or a pull ends with it. */
function closedSignalOf(natsConnection: NatsConnection): AbortSignal {
  const closed = new AbortController();
  const abort = () => closed.abort();
  natsConnection.closed().then(abort, abort);
  return closed.signal;
}

/** The prefix of the inboxes the Service opened its connection with, which a pull replies on as nats.js's pulls do. */
function inboxPrefixOf(natsConnection: NatsConnection): string | undefined {
  return (natsConnection as Partial<NatsConnectionImpl>).options?.inboxPrefix;
}

function natsHeadersOf(message: OutgoingMessage) {
  const natsHeaders = headers();
  for (const [name, value] of Object.entries(brokerHeadersOf(message))) {
    natsHeaders.set(name, value);
  }
  return natsHeaders;
}
