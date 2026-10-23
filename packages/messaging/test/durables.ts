import {
  type ConsumerConfig,
  type ConsumerInfo,
  JetStreamApiCodes,
  JetStreamApiError,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

/** Creates a durable consumer as a test arranges it, with the NATS client and not through `apply`. */
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

/** What NATS holds about a durable consumer, read with the NATS client; undefined when it holds none. */
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

/** The configuration NATS holds for a durable consumer, read with the NATS client. */
export async function durableConfigOf(
  url: string,
  stream: string,
  durable: string,
): Promise<ConsumerConfig> {
  const info = await durableInfoOf(url, stream, durable);
  if (info === undefined) {
    throw new Error(`The durable consumer ${durable} does not exist on ${stream}`);
  }
  return info.config;
}
