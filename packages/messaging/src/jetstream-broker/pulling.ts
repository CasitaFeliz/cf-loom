import type { NatsConnection } from '@nats-io/nats-core';
import { type ConsumeRun, pause, troubleReportingOf } from '../broker/index.ts';
import { deliver } from './delivering.ts';
import type { FoundDurableConsumer } from './finding.ts';
import { pullOnce } from './pull-once.ts';
import type { PulledMessage } from './pulled-message.ts';

/** What one Durable consumer's pulls run with: the core's `troubled`, and `stopping`, which aborts when the core starts closing or the connection closes. */
export type PullRun = Pick<ConsumeRun, 'troubled'> & { readonly stopping: AbortSignal };

/**
 * Pulls one Message at a time from a Durable consumer and delivers it, until `stopping` aborts, which is
 * when the core starts closing or the connection closes; a pull that fails is tried again after a pause.
 */
export async function pullFrom(
  found: FoundDurableConsumer,
  natsConnection: NatsConnection,
  run: PullRun,
): Promise<void> {
  const { stopping } = run;
  const { durableConsumer } = found;
  const reporting = troubleReportingOf(durableConsumer, run.troubled);
  while (isPulling(natsConnection, stopping)) {
    const pull = await pullOnce(found.request, natsConnection, stopping);
    if (isPulling(natsConnection, stopping)) {
      reporting.pulled(pull);
    }
    switch (pull.kind) {
      case 'message':
        await deliveredOrHandedBack(pull.message, found, stopping);
        break;
      case 'none':
        break;
      case 'failed':
        await pause(stopping);
        break;
    }
  }
  if (!reporting.isFailing()) {
    run.troubled({
      durableConsumer,
      kind: 'pull-failed',
      cause: new Error('The NATS connection closed'),
    });
  }
}

function isPulling(natsConnection: NatsConnection, stopping: AbortSignal): boolean {
  return !stopping.aborted && !natsConnection.isClosed() && !natsConnection.isDraining();
}

/** A Message that was already on its way when pulling stopped goes back to NATS for another process, not to a Handler. */
async function deliveredOrHandedBack(
  message: PulledMessage,
  found: FoundDurableConsumer,
  stopping: AbortSignal,
): Promise<void> {
  if (stopping.aborted) {
    message.nak();
    return;
  }
  await deliver(message, found);
}
