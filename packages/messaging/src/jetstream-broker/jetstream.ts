import { type Closed, joinedOf, unbrokenLineOf, wordOf } from '@cf-loom/contract/internal';
import type { JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { type Broker, type BrokerPrefixed, checkedPrefixOf, planRemedy } from '../broker/index.ts';
import { drainOrClose, jetStreamConnectionOf } from './connection.ts';
import {
  checkedStreamOf,
  managerOf,
  type PrefixedStream,
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
export type JetStreamBrokerOptions = JetStreamConnecting & BrokerPrefixed;

/** A Broker on NATS JetStream: each `messaging()` opens its own connection and starts only once the Service's Stream holds every subject it publishes and sends. */
export function jetstream<const Given = unknown>(
  options: Closed<Given, JetStreamBrokerOptions>,
): Broker {
  const prefix = checkedPrefixOf(options.prefix);
  return {
    connect: async (serviceStream) => {
      const natsConnection = await options.connect();
      const stream = prefixedStreamOf(serviceStream, prefix);
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
      throw new Error(unbrokenLineOf(refusal));
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
      return `The stream ${stream.name} does not hold ${joinedOf(check.subjects.map(wordOf), 'and')}: ${planRemedy}`;
  }
}
