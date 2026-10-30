import type { ServiceContract } from '@cf-loom/contract';
import { jetstreamManager, type StreamConfig, type StreamInfo } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { planOf } from './broker-plans.ts';

/** A stream as a test arranges it. */
export type ArrangedStream = { readonly name: string; readonly subjects: readonly string[] };

/** Creates a stream as a test arranges it, with the NATS client and not through `applyBrokerPlan`, and the NATS settings given over NATS's defaults. */
export async function arrangeStream(
  url: string,
  stream: ArrangedStream,
  settings: Partial<StreamConfig> = {},
): Promise<void> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    await manager.streams.add({ ...settings, name: stream.name, subjects: [...stream.subjects] });
  } finally {
    await connection.close();
  }
}

/** What NATS holds about a stream, read with the NATS client. */
export async function streamInfoOf(url: string, name: string): Promise<StreamInfo> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    return await manager.streams.info(name);
  } finally {
    await connection.close();
  }
}

/** The configuration NATS holds for a stream, read with the NATS client. */
export async function streamConfigOf(url: string, name: string): Promise<StreamConfig> {
  const info = await streamInfoOf(url, name);
  return info.config;
}

/** Deletes a stream a test arranged, with the NATS client. */
export async function dropStream(url: string, name: string): Promise<void> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    await manager.streams.delete(name);
  } finally {
    await connection.close();
  }
}

/** Creates the streams of a Service's broker plan under a prefix, as the organization's tooling would from `cf-loom broker-plan`. */
export async function arrangePlanOf(
  url: string,
  contract: ServiceContract,
  prefix: string | null,
): Promise<void> {
  const plan = planOf(contract, prefix);
  for (const [name, stream] of Object.entries(plan.streams)) {
    await arrangeStream(url, { name, subjects: stream.subjects });
  }
}
