import { faultLogOf, issueLineOf } from '@cf-loom/handlers/internal';
import type { ConsumedFault } from '../broker/index.ts';

/** What hears of a `ConsumedFault`: the Service's `onServiceFault`, or the console without one. */
export type Report = (fault: ConsumedFault) => void;

/** The Service's hook, or the console line of every fault. */
export function reportOf(onServiceFault: Report | undefined): Report {
  return onServiceFault ?? logConsumedFault;
}

/** A fault on the console: each Issue's part, path, code and message, or the Fault's message or the throw, with its cause. */
function logConsumedFault(fault: ConsumedFault): void {
  const where = `${fault.element} ${fault.subject} ${fault.messageId} ${fault.factId}`;
  switch (fault.kind) {
    case 'invalid-body':
      for (const issue of fault.issues) {
        console.error(issueLineOf(where, issue));
      }
      return;
    case 'returned':
      console.error(...faultLogOf(where, fault.fault));
      return;
    case 'thrown':
      console.error(...faultLogOf(where, { message: 'the Handler threw', cause: fault.cause }));
  }
}
