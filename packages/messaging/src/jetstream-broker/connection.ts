import { brokerHeadersOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type JetStreamOptions, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import { headers, type NatsConnection } from '@nats-io/nats-core';
import type { BrokerConnection, OutgoingMessage } from '../broker/index.ts';

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
    // TODO(#128)
    consume: () => Promise.reject(new Error('jetstream() does not consume yet')),
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

function natsHeadersOf(message: OutgoingMessage) {
  const natsHeaders = headers();
  for (const [name, value] of Object.entries(brokerHeadersOf(message))) {
    natsHeaders.set(name, value);
  }
  return natsHeaders;
}
