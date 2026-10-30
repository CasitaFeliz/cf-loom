import type { ConsumeRun } from '../broker/index.ts';
import { pause, troubleReportingOf } from '../broker/index.ts';
import { deliver, handBack, type Prepared, preparedFrom, type QueueRun } from './delivering.ts';
import type { FoundQueue } from './queue-finding.ts';
import { receiveOnce } from './receive-once.ts';
import type { ReceivedMessage } from './received-reading.ts';

/** What one Durable consumer's loop runs with: the core's `troubled` besides what delivering needs. */
export type Receiving = QueueRun & Pick<ConsumeRun, 'troubled'>;

/** Receives one Message at a time from the Durable consumer's queue and delivers it, until `closing` aborts; a receive that fails is tried again after a pause. */
export async function receiveFrom(queue: FoundQueue, run: Receiving): Promise<void> {
  const reporting = troubleReportingOf(queue.durableConsumer, run.troubled);
  while (!run.closing.aborted) {
    const pulled = await pulledFrom(queue, run);
    reporting.pulled(pulled.kind === 'ready' ? { kind: 'message' } : pulled);
    switch (pulled.kind) {
      case 'ready':
        await deliver(run, pulled.received, pulled.delivery);
        break;
      case 'none':
        break;
      case 'failed':
        await pause(run.closing);
        break;
    }
  }
}

type Pulled =
  | (Extract<Prepared, { kind: 'ready' }> & { readonly received: ReceivedMessage })
  | Exclude<Prepared, { kind: 'ready' }>;

/** One pull: the receive and, for a Message that is one of cf-loom's, the visibility change that comes before its Handler; a Message that arrives once closing started is handed back. */
async function pulledFrom(queue: FoundQueue, run: Receiving): Promise<Pulled> {
  const pull = await receiveOnce(run.sqs, queue.url);
  if (pull.kind !== 'message') {
    return pull;
  }
  const received = { queue, message: pull.message };
  if (run.closing.aborted) {
    return await handedBack(run, received);
  }
  const prepared = await preparedFrom(run, received);
  if (prepared.kind !== 'ready') {
    return prepared;
  }
  return run.closing.aborted ? await handedBack(run, received) : { ...prepared, received };
}

async function handedBack(run: Receiving, received: ReceivedMessage): Promise<Pulled> {
  await handBack(run, received);
  return { kind: 'none' };
}
