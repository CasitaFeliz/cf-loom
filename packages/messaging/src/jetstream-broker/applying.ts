import { decodeBrokerPlan } from '@cf-loom/contract/internal';
import type { JetStreamManager, JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Applied } from './applied.ts';
import { drainOrClose, drainOrCloseAfterFailure } from './connection.ts';
import { applyDurable } from './durable-applying.ts';
import { type ResolvedPlan, settingsOf } from './settings.ts';
import { applyStream } from './stream-applying.ts';
import { managerOf } from './stream-check.ts';

/** What `apply` needs of the adapter that has it: the Service's way to connect, the prefix of every name and the options of the NATS client. */
export type Applier = {
  readonly connect: () => Promise<NatsConnection>;
  readonly prefix: string | null;
  readonly jetstream: JetStreamOptions | undefined;
};

type Checked = ResolvedPlan | { readonly kind: 'refused'; readonly message: string };

/**
 * Applies a broker plan: it checks the plan, its prefix and the limits before it connects, so a
 * refusal creates nothing, then applies every stream before every durable consumer on a connection of
 * its own, which it drains at the end.
 */
export async function applyPlan(applier: Applier, plan: unknown, limits: unknown): Promise<void> {
  const checked = checkedOf(applier.prefix, plan, limits);
  if (checked.kind === 'refused') {
    throw new Error(checked.message);
  }
  const applied = await appliedOn(applier, checked);
  if (applied.kind === 'refused') {
    throw new Error(applied.message, { cause: applied.cause });
  }
}

function checkedOf(prefix: string | null, plan: unknown, limits: unknown): Checked {
  const decoded = decodeBrokerPlan(plan);
  if (decoded.kind === 'malformed') {
    const shape = 'The broker plan is not the shape cf-loom broker-plan --json prints';
    return { kind: 'refused', message: `${shape}: ${decoded.reason}` };
  }
  if (decoded.plan.prefix !== prefix) {
    const planned = decoded.plan.prefix ?? 'none';
    const message = `The broker plan's prefix is ${planned}, but this broker's is ${prefix ?? 'none'}`;
    return { kind: 'refused', message };
  }
  const settings = settingsOf(decoded.plan, limits);
  return settings.kind === 'refused'
    ? { kind: 'refused', message: settings.lines.join('\n') }
    : settings;
}

async function appliedOn(applier: Applier, settings: ResolvedPlan): Promise<Applied> {
  const natsConnection = await applier.connect();
  let applied: Applied;
  try {
    const manager = await managerOf(natsConnection, applier.jetstream);
    applied = await applyAll(manager, settings);
  } catch (error) {
    await drainOrCloseAfterFailure(natsConnection);
    throw error;
  }
  if (applied.kind === 'refused') {
    await drainOrCloseAfterFailure(natsConnection);
  } else {
    await drainOrClose(natsConnection);
  }
  return applied;
}

async function applyAll(manager: JetStreamManager, settings: ResolvedPlan): Promise<Applied> {
  for (const stream of settings.streams) {
    const applied = await applyStream(manager, stream);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  for (const durable of settings.durables) {
    const applied = await applyDurable(manager, durable);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  return { kind: 'applied' };
}
