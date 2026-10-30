import type { ConsumeRun } from '../broker/index.ts';
import { pause, troubleReportingOf } from '../broker/index.ts';
import { deliver, type QueueRun } from './delivering.ts';
import type { FoundQueue } from './queue-finding.ts';
import { receiveOnce } from './receive-once.ts';

/** What one Durable consumer's loop runs with: the core's `troubled` besides what delivering needs. */
export type Receiving = QueueRun & Pick<ConsumeRun, 'troubled'>;

/** Receives one Message at a time from the Durable consumer's queue and delivers it, until `closing` aborts; a receive that fails is tried again after a pause. */
export async function receiveFrom(queue: FoundQueue, run: Receiving): Promise<void> {
  const reporting = troubleReportingOf(queue.durableConsumer, run.troubled);
  while (!run.closing.aborted) {
    const pull = await receiveOnce(run.sqs, queue.url);
    reporting.pulled(pull);
    switch (pull.kind) {
      case 'message':
        await deliver(run, { queue, message: pull.message });
        break;
      case 'none':
        break;
      case 'failed':
        await pause(run.closing);
        break;
    }
  }
}
