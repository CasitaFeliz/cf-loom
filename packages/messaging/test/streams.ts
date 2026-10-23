import type { Contract } from '@cf-loom/contract';
import {
  brokerPlanOf,
  schemaOriginsOf,
  snapshotOf,
  validateContract,
} from '@cf-loom/contract/internal';
import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

/** A stream as a test arranges it. */
export type ArrangedStream = { readonly name: string; readonly subjects: readonly string[] };

/** Creates a stream as a test arranges it, with the NATS client and not through `apply`. */
export async function arrangeStream(url: string, stream: ArrangedStream): Promise<void> {
  const nc = await connect({ servers: url });
  try {
    const jsm = await jetstreamManager(nc);
    await jsm.streams.add({ name: stream.name, subjects: [...stream.subjects] });
  } finally {
    await nc.close();
  }
}

/** Deletes a stream a test arranged, with the NATS client. */
export async function dropStream(url: string, name: string): Promise<void> {
  const nc = await connect({ servers: url });
  try {
    const jsm = await jetstreamManager(nc);
    await jsm.streams.delete(name);
  } finally {
    await nc.close();
  }
}

/** Creates the streams of a Service's broker plan under a prefix, as the organization's tooling would from `cf-loom broker-plan`. */
export async function arrangePlanOf(
  url: string,
  contract: Contract,
  prefix: string | null,
): Promise<void> {
  const plan = brokerPlanOf(serviceSnapshotOf(contract), prefix);
  for (const [name, stream] of Object.entries(plan.streams)) {
    await arrangeStream(url, { name, subjects: stream.subjects });
  }
}

function serviceSnapshotOf(contract: Contract) {
  const originOf = schemaOriginsOf([]);
  const validated = validateContract(contract, {
    originOf,
    packageName: contract.name,
    exportsOf: () => [],
  });
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const context = { generator: 'test', packages: [], committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}
