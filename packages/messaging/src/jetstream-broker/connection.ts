import { brokerHeadersOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type JetStreamOptions, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import { headers, type NatsConnection } from '@nats-io/nats-core';
import type { BrokerConnection, OutgoingMessage } from '../broker/index.ts';
import { bindingsOf } from './binding.ts';
import { pullFrom } from './pulling.ts';
import { managerOf } from './stream-check.ts';

/** The connection `messaging()` publishes, consumes and closes through, over the NATS connection the Service opened. */
export function jetStreamConnectionOf(
  natsConnection: NatsConnection,
  prefix: string | null,
  options: JetStreamOptions | undefined,
): BrokerConnection {
  const client = jetStreamClientOf(natsConnection, options);
  const loops: Promise<void>[] = [];
  return {
    publish: async (message) => {
      const subject = prefixedSubjectOf(prefix, message.subject);
      await client.publish(subject, message.body, { headers: natsHeadersOf(message) });
    },
    consume: async (consumers, closing) => {
      const manager = await managerOf(natsConnection, options);
      const bound = await bindingsOf(manager, prefix, consumers);
      if (bound.kind === 'refused') {
        throw new Error(bound.lines.join('\n'));
      }
      const stopping = AbortSignal.any([closing, closedSignalOf(natsConnection)]);
      for (const binding of bound.bindings) {
        loops.push(pullFrom(binding, natsConnection, stopping));
      }
    },
    close: async () => {
      await drainOnce(natsConnection);
      await Promise.all(loops);
    },
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

function natsHeadersOf(message: OutgoingMessage) {
  const natsHeaders = headers();
  for (const [name, value] of Object.entries(brokerHeadersOf(message))) {
    natsHeaders.set(name, value);
  }
  return natsHeaders;
}
