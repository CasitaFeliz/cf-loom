import { type BrokerPlan, isBrokerPrefix } from '@cf-loom/contract/internal';
import type { JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Broker } from '../broker/index.ts';
import { type Applier, applyPlan } from './applying.ts';
import { drainOrCloseAfterFailure, jetStreamConnectionOf } from './connection.ts';
import type { BrokerLimits } from './limits.ts';
import {
  checkedStreamOf,
  managerOf,
  type PrefixedStream,
  planRemedy,
  prefixedStreamOf,
  type StreamCheck,
} from './stream-check.ts';

/** What `jetstream()` takes: the Service's own way to open a NATS connection, the prefix of every name it uses on the Broker, and the options of nats.js's JetStream client, if any. */
export type JetStreamBrokerOptions = {
  /** Opens one NATS connection with the transport and authentication the Service chooses; cf-loom calls it once for each `messaging()` and each `apply`, and drains what it returns. */
  readonly connect: () => Promise<NatsConnection>;
  /** Goes in front of every subject, stream and durable consumer name, so several environments share one Broker; kebab-case, as a Service name is. */
  readonly prefix?: string | undefined;
  /** Handed unchanged to nats.js's `jetstream()` and `jetstreamManager()`: a JetStream domain, an API prefix, a request timeout; the manager also gets `checkAPI: false`, so no `$JS.API.INFO` is requested. */
  readonly jetstream?: JetStreamOptions | undefined;
};

/** A Broker on NATS JetStream that can also apply a Service's broker plan, which `messaging()` never does. */
export type JetStreamBroker = Broker & {
  /**
   * Creates the plan's streams, then its durable consumers, adding subjects and updating limits and
   * never removing anything; it stops at the first it cannot apply, keeping what it did.
   */
  readonly apply: (plan: BrokerPlan, limits: BrokerLimits) => Promise<void>;
};

/**
 * A Broker on NATS JetStream: each `messaging()` opens its own connection and starts only once the
 * Service's stream holds every subject it publishes and sends; `apply` applies a broker plan on a
 * connection of its own.
 */
export function jetstream(options: JetStreamBrokerOptions): JetStreamBroker {
  const prefix = checkedPrefixOf(options.prefix);
  const applier: Applier = { connect: options.connect, prefix, jetstream: options.jetstream };
  return {
    apply: (plan, limits) => applyPlan(applier, plan, limits),
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
    await drainOrCloseAfterFailure(natsConnection);
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
