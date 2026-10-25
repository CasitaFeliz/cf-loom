import type { NatsConnection } from '@nats-io/nats-core';
import type { BrokerConsumer, ConsumeRun } from '../broker/index.ts';
import { deliver } from './delivering.ts';
import type { FoundDurable } from './finding.ts';
import { type Pull, pullOnce } from './pull-once.ts';
import type { PulledMessage } from './pulled-message.ts';

/** How long a durable consumer waits before it pulls again after a pull failed, as when its durable consumer was deleted. */
const retryPauseMs = 1_000;

/** What one durable consumer's pulls run with: the core's `troubled`, and `stopping`, which aborts when the core starts closing or the connection closes. */
export type PullRun = Pick<ConsumeRun, 'troubled'> & { readonly stopping: AbortSignal };

/**
 * Pulls one Message at a time from a durable consumer and delivers it, until `stopping` aborts, which is
 * when the core starts closing or the connection closes; a pull that fails is tried again after a pause.
 */
export async function pullFrom(
  durable: FoundDurable,
  natsConnection: NatsConnection,
  run: PullRun,
): Promise<void> {
  const { stopping } = run;
  const reporting = troubleReportingOf(durable.consumer, run);
  while (isPulling(natsConnection, stopping)) {
    const pull = await pullOnce(durable.request, natsConnection, stopping);
    if (isPulling(natsConnection, stopping)) {
      reporting.pulled(pull);
    }
    switch (pull.kind) {
      case 'message':
        await deliveredOrHandedBack(pull.message, durable, stopping);
        break;
      case 'none':
        break;
      case 'failed':
        await pause(stopping);
        break;
    }
  }
  reporting.ended();
}

/**
 * Tells the core of a durable consumer's first failed pull, of the first answered one after it, and
 * of a loop that ended while not failing, as a closed connection ends it; the core drops what comes once it is closing.
 */
function troubleReportingOf(consumer: BrokerConsumer, { troubled }: PullRun) {
  let failing = false;
  return {
    pulled: (pull: Pull) => {
      if (pull.kind === 'failed' && !failing) {
        troubled({ consumer, kind: 'pull-failed', cause: pull.cause });
      }
      if (pull.kind !== 'failed' && failing) {
        troubled({ consumer, kind: 'recovered' });
      }
      failing = pull.kind === 'failed';
    },
    ended: () => {
      if (!failing) {
        troubled({ consumer, kind: 'pull-failed', cause: new Error('The NATS connection closed') });
      }
    },
  };
}

function isPulling(natsConnection: NatsConnection, stopping: AbortSignal): boolean {
  return !stopping.aborted && !natsConnection.isClosed() && !natsConnection.isDraining();
}

/** A Message that was already on its way when pulling stopped goes back to NATS for another process, not to a Handler. */
async function deliveredOrHandedBack(
  message: PulledMessage,
  durable: FoundDurable,
  stopping: AbortSignal,
): Promise<void> {
  if (stopping.aborted) {
    message.nak();
    return;
  }
  await deliver(message, durable);
}

/** Waits the retry pause, or less when `stopping` aborts; its timer and listener never outlive it. */
function pause(stopping: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      stopping.removeEventListener('abort', wake);
      resolve();
    };
    const timer = setTimeout(wake, retryPauseMs);
    stopping.addEventListener('abort', wake);
    if (stopping.aborted) {
      wake();
    }
  });
}
