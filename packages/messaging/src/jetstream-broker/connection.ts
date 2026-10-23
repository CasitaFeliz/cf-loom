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
      await client.publish(subject, message.body, { headers: natsHeadersOf(message) });
    },
    consume: async (consumers, closing) => {
      const manager = await managerOf(natsConnection, options);
      const inboxPrefix = inboxPrefixOf(natsConnection);
      const search = { manager, prefix, apiPrefix: client.apiPrefix, inboxPrefix };
      const found = await durablesFoundOf(search, consumers);
      if (found.kind === 'refused') {
        throw new Error(found.lines.join('\n'));
      }
      const stopping = AbortSignal.any([closing, closedSignalOf(natsConnection)]);
      for (const durable of found.durables) {
        void pullFrom(durable, natsConnection, stopping);
      }
    },
    close: () => drainOnce(natsConnection),
  };
}

/**
 * Drains the connection the Service opened, unless it is closed already, or draining because the
 * Service started that, and then waits for it; so no drain replaces the error that led to it.
 */
export async function drainOnce(natsConnection: NatsConnection): Promise<void> {
  if (natsConnection.isClosed()) {
    return;
  }
  if (natsConnection.isDraining()) {
    await natsConnection.closed();
    return;
  }
  await natsConnection.drain();
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
