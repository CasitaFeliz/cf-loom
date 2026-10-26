import { isBrokerPrefix } from '@cf-loom/contract/internal';
import type { JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Broker } from '../broker/index.ts';
import { drainOrClose, jetStreamConnectionOf } from './connection.ts';
import {
  checkedStreamOf,
  managerOf,
  type PrefixedStream,
  planRemedy,
  prefixedStreamOf,
  type StreamCheck,
} from './stream-check.ts';

/** How cf-loom opens a NATS connection: the Service's own way, and the options of nats.js's JetStream client, if any. */
export type JetStreamConnecting = {
  /** Opens one NATS connection with the transport and authentication the Service chooses; cf-loom drains what it returns. */
  readonly connect: () => Promise<NatsConnection>;
  /** Handed unchanged to nats.js's `jetstream()` and `jetstreamManager()`; the manager also gets `checkAPI: false`, so no `$JS.API.INFO` is requested. */
  readonly jetstream?: JetStreamOptions | undefined;
};

/** What `jetstream()` takes: how to connect, and the Broker prefix of every name it uses on the Broker. */
export type JetStreamBrokerOptions = JetStreamConnecting & {
  /** Goes in front of every subject, Stream and Durable consumer name, so several environments share one Broker; kebab-case, as a Service name is. */
  readonly prefix?: string | undefined;
};

/** A Broker on NATS JetStream: each `messaging()` opens its own connection and starts only once the Service's Stream holds every subject it publishes and sends. */
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
    const manager = await managerOf(natsConnection, options);
    const refusal = refusalOf(stream, await checkedStreamOf(manager, stream));
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
  } catch (error) {
    await drainOrClose(natsConnection);
    throw error;
  }
}

function refusalOf(stream: PrefixedStream, check: StreamCheck): string | undefined {
  switch (check.kind) {
    case 'complete':
      return undefined;
    case 'absent':
      return `The stream ${stream.name} does not exist: ${planRemedy}`;
    case 'missing-subjects':
      return `The stream ${stream.name} does not hold ${check.subjects.join(', ')}: ${planRemedy}`;
  }
}

function checkedPrefixOf(prefix: string | undefined): string | null {
  if (prefix === undefined) {
    return null;
  }
  if (!isBrokerPrefix(prefix)) {
    throw new Error(
      `The broker prefix "${prefix}" is not kebab-case, such as staging: leave prefix undefined for none`,
    );
  }
  return prefix;
}
