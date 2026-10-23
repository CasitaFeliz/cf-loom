import { isBrokerPrefix } from '@cf-loom/contract/internal';
import type { JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Broker } from '../broker/index.ts';
import { drainUnlessClosed, jetStreamConnectionOf } from './connection.ts';
import { missingSubjectsOf, type PrefixedStream, prefixedStreamOf } from './stream-check.ts';

/** What `jetstream()` takes: the Service's own way to open a NATS connection, the prefix of every name it uses on the Broker, and the options of nats.js's JetStream client, if any. */
export type JetStreamBrokerOptions = {
  /** Opens one NATS connection with the transport and authentication the Service chooses; cf-loom calls it once for each `messaging()` and drains what it returns. */
  readonly connect: () => Promise<NatsConnection>;
  /** Goes in front of every subject, stream and durable consumer name, so several environments share one Broker; kebab-case, as a Service name is. */
  readonly prefix?: string | undefined;
  /** Handed unchanged to nats.js's `jetstream()` and `jetstreamManager()`: a JetStream domain, an API prefix, a request timeout; the manager also gets `checkAPI: false`, so no `$JS.API.INFO` is requested. */
  readonly jetstream?: JetStreamOptions | undefined;
};

/**
 * A Broker on NATS JetStream: each `messaging()` opens its own connection and starts only once the
 * Service's stream holds every subject it publishes and sends.
 */
export function jetstream(options: JetStreamBrokerOptions): Broker {
  const prefix = checkedPrefixOf(options.prefix);
  return {
    connect: async (service) => {
      const natsConnection = await options.connect();
      const stream = prefixedStreamOf(service, prefix);
      await checkStreamOrDrain(natsConnection, stream, options.jetstream);
      return jetStreamConnectionOf(natsConnection, prefix, options.jetstream);
    },
  };
}

async function checkStreamOrDrain(
  natsConnection: NatsConnection,
  stream: PrefixedStream,
  options: JetStreamOptions | undefined,
): Promise<void> {
  try {
    const missing = await missingSubjectsOf(natsConnection, stream, options);
    if (missing.length > 0) {
      const subjects = missing.join(', ');
      throw new Error(
        `The stream ${stream.name} does not hold ${subjects}: apply the Service's broker plan`,
      );
    }
  } catch (error) {
    await drainUnlessClosed(natsConnection);
    throw error;
  }
}

function checkedPrefixOf(prefix: string | undefined): string | null {
  if (prefix === undefined) {
    return null;
  }
  if (!isBrokerPrefix(prefix)) {
    throw new Error(`The broker prefix "${prefix}" is not kebab-case, such as staging`);
  }
  return prefix;
}
