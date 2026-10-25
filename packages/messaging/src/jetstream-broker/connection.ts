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
    close: () => drainOrClose(natsConnection),
  };
}

/**
 * Ends a connection the Service opened, which cf-loom drains, or waits for the Service's drain of, and resolves
 * once it is closed, whoever closed it. When NATS does not answer, it closes the connection without the drain and
 * rejects with an error saying so, NATS's error as `cause`.
 */
export async function drainOrClose(natsConnection: NatsConnection): Promise<void> {
  if (natsConnection.isClosed()) {
    return;
  }
  const answered = natsConnection.isDraining() ? natsConnection.flush() : natsConnection.drain();
  try {
    await Promise.race([natsConnection.closed(), answered.then(() => natsConnection.closed())]);
  } catch (cause) {
    await natsConnection.close();
    throw new Error('NATS did not answer the drain, so the connection was closed without it', {
      cause,
    });
  }
}

/** Ends a connection after a failure of the caller's own, whose error is the one to reach it, so the drain's is dropped. */
export async function drainOrCloseAfterFailure(natsConnection: NatsConnection): Promise<void> {
  await drainOrClose(natsConnection).catch(() => undefined);
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
