// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import type { BrokerPlan } from '@cf-loom/contract/internal';
import {
  type ConsumerConfig,
  type ConsumerInfo,
  JetStreamApiCodes,
  JetStreamApiError,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

/** Creates a Durable consumer as a test arranges it, with the NATS client and not through `applyBrokerPlan`. */
export async function arrangeDurable(
  url: string,
  stream: string,
  config: Partial<ConsumerConfig>,
): Promise<void> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    await manager.consumers.add(stream, config);
  } finally {
    await connection.close();
  }
}

/**
 * Creates every Durable consumer of a broker plan as the organization's tooling would from
 * `cf-loom broker-plan`, with the NATS client and not `applyBrokerPlan`: a pull consumer with explicit
 * acknowledgements filtered on its subject, with `settings` over that.
 */
export async function arrangeDurablesOf(
  url: string,
  plan: BrokerPlan,
  settings: Partial<ConsumerConfig> = {},
): Promise<void> {
  for (const [name, durable] of Object.entries(plan.durableConsumers)) {
    const shape = { ack_policy: 'explicit', filter_subject: durable.subject } as const;
    await arrangeDurable(url, durable.stream, { ...shape, ...settings, durable_name: name });
  }
}

/** Deletes a Durable consumer a test arranged, with the NATS client. */
export async function dropDurable(url: string, stream: string, durable: string): Promise<void> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    await manager.consumers.delete(stream, durable);
  } finally {
    await connection.close();
  }
}

/** What NATS holds about a Durable consumer, read with the NATS client; undefined when it holds none. */
export async function durableInfoOf(
  url: string,
  stream: string,
  durable: string,
): Promise<ConsumerInfo | undefined> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    return await manager.consumers.info(stream, durable);
  } catch (error) {
    if (error instanceof JetStreamApiError && error.code === JetStreamApiCodes.ConsumerNotFound) {
      return undefined;
    }
    throw error;
  } finally {
    await connection.close();
  }
}

/** The configuration NATS holds for a Durable consumer, read with the NATS client. */
export async function durableConfigOf(
  url: string,
  stream: string,
  durable: string,
): Promise<ConsumerConfig> {
  const info = await durableInfoOf(url, stream, durable);
  if (info === undefined) {
    throw new Error(`The Durable consumer ${durable} does not exist on ${stream}`);
  }
  return info.config;
}
