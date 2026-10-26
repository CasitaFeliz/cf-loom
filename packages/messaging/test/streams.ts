import type { ServiceContract } from '@cf-loom/contract';
import {
  type BrokerPlan,
  brokerPlanOf,
  snapshotOf,
  validateRoot,
} from '@cf-loom/contract/internal';
import { jetstreamManager, type StreamConfig, type StreamInfo } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

/** A stream as a test arranges it. */
export type ArrangedStream = { readonly name: string; readonly subjects: readonly string[] };

/** Creates a stream as a test arranges it, with the NATS client and not through `apply`, and the NATS settings given over NATS's defaults. */
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

/** The broker plan `cf-loom broker-plan` derives from a Service's Contract under a prefix. */
export function planOf(contract: ServiceContract, prefix: string | null): BrokerPlan {
  return brokerPlanOf(serviceSnapshotOf(contract), prefix);
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

function serviceSnapshotOf(contract: ServiceContract) {
  const validated = validateRoot(contract, {
    packageName: contract.name,
    packages: [],
    rootExports: {},
  });
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}
