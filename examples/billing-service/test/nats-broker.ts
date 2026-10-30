// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  applyBrokerPlan,
  type BrokerPlan,
  type JetStreamBrokerLimits,
} from '@cf-loom/messaging/jetstream';
import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

/** Every setting of a test's plans, for one throwaway nats-server, which holds one replica of anything. */
const testLimits: JetStreamBrokerLimits = {
  durableConsumerDefaults: {
    ackWait: '30s',
    deliverPolicy: 'all',
    maxAckPending: 100,
    maxDeliver: 5,
  },
  streamDefaults: {
    duplicateWindow: '2m',
    maxAge: '1h',
    replicas: 1,
    retention: 'limits',
    storage: 'memory',
  },
};

/** The plan `cf-loom broker-plan --json --prefix <prefix>` prints for the Service in `serviceDir`. */
function planOf(serviceDir: string, prefix: string): BrokerPlan {
  const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
  const ran = spawnSync(process.execPath, [bin, 'broker-plan', '--json', '--prefix', prefix], {
    cwd: serviceDir,
    encoding: 'utf8',
    env: {},
  });
  if (ran.status !== 0) {
    throw new Error(`cf-loom broker-plan failed in ${serviceDir}: ${ran.stderr}`);
  }
  return JSON.parse(ran.stdout).plan;
}

/** Applies the plan of the Service in `serviceDir` to the nats-server at `url`, as the organization's deploy step would. */
export async function applyPlanOf(serviceDir: string, url: string, prefix: string): Promise<void> {
  const connecting = { connect: () => connect({ servers: url }) };
  await applyBrokerPlan(connecting, planOf(serviceDir, prefix), testLimits);
}

/** The stream sequence and Fact id of the last Message on a subject; undefined while the subject holds none. */
export async function lastMessageOn(
  url: string,
  stream: string,
  subject: string,
): Promise<{ readonly seq: number; readonly factId: string } | undefined> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    const stored = await manager.streams.getMessage(stream, { last_by_subj: subject });
    if (stored === null) {
      return undefined;
    }
    return { factId: stored.header.get('Cf-Loom-Fact-Id'), seq: stored.seq };
  } finally {
    await connection.close();
  }
}

/** What a Durable consumer has settled and still holds. */
export type DurableConsumerState = {
  /** The stream sequence up to which every delivery is settled. */
  readonly ackFloor: number;
  /** Messages the Durable consumer has not delivered yet. */
  readonly pending: number;
  /** Deliveries waiting for their acknowledgement. */
  readonly ackPending: number;
  /** Redeliveries so far. */
  readonly redelivered: number;
};

/** What NATS holds about a Durable consumer's progress. */
export async function durableConsumerStateOf(
  url: string,
  stream: string,
  durable: string,
): Promise<DurableConsumerState> {
  const connection = await connect({ servers: url });
  try {
    const manager = await jetstreamManager(connection);
    const consumerInfo = await manager.consumers.info(stream, durable);
    return {
      ackFloor: consumerInfo.ack_floor.stream_seq,
      ackPending: consumerInfo.num_ack_pending,
      pending: consumerInfo.num_pending,
      redelivered: consumerInfo.num_redelivered,
    };
  } finally {
    await connection.close();
  }
}
