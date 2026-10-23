import { isBrokerPrefix } from '@cf-loom/contract/internal';
import type { JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Broker } from '../broker/index.ts';
import { jetStreamConnectionOf } from './connection.ts';
import { missingSubjectsOf, type Requirement, requirementOf } from './stream-check.ts';

/** What `jetstream()` takes: the Service's own way to open a NATS connection, the prefix of every name it uses on the Broker, and the options of nats.js's JetStream client, if any. */
export type JetStreamBrokerOptions = {
  /** Opens one NATS connection with the transport and authentication the Service chooses; cf-loom calls it once for each `messaging()` and drains what it returns. */
  readonly connect: () => Promise<NatsConnection>;
  /** Goes in front of every subject, stream and durable consumer name, so several environments share one Broker; kebab-case, as a Service name is. */
  readonly prefix?: string | undefined;
  /** Handed unchanged to nats.js's `jetstream()` and `jetstreamManager()`: a JetStream domain, an API prefix, a request timeout. */
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
      const nc = await options.connect();
      await holdingOrDrained(nc, requirementOf(service, prefix), options.jetstream);
      return jetStreamConnectionOf(nc, prefix, options.jetstream);
    },
  };
}

async function holdingOrDrained(
  nc: NatsConnection,
  required: Requirement,
  options: JetStreamOptions | undefined,
): Promise<void> {
  try {
    const missing = await missingSubjectsOf(nc, required, options);
    if (missing.length > 0) {
      const message = `The stream ${required.stream} does not hold ${missing.join(', ')}`;
      throw new Error(`${message}: apply the Service's broker plan`);
    }
  } catch (error) {
    await nc.drain();
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
