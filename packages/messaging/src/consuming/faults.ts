import { issueLineOf } from '@cf-loom/handlers/internal';
import type { ConsumedFault } from '../broker/index.ts';

/** What hears of a `ConsumedFault`: the Service's `onServiceFault`, or the console without one. */
export type Report = (fault: ConsumedFault) => void;

/** The Service's hook, or the console line of every fault. */
export function reportOf(onServiceFault: Report | undefined): Report {
  return onServiceFault ?? logConsumedFault;
}

/** A fault on the console: each Issue's part, path, code and message, or the Fault's message or the throw, with its cause. */
function logConsumedFault(fault: ConsumedFault): void {
  const where = `${fault.element} ${fault.subject} ${fault.messageId}`;
  switch (fault.kind) {
    case 'invalid-body':
      for (const issue of fault.issues) {
        console.error(issueLineOf(where, issue));
      }
      return;
    case 'returned':
      logWithCause(`${where}: ${fault.fault.message}`, fault.fault.cause);
      return;
    case 'thrown':
      logWithCause(`${where}: the Handler threw`, fault.cause);
  }
}

function logWithCause(line: string, cause: unknown): void {
  if (cause === undefined) {
    console.error(line);
    return;
  }
  console.error(line, cause);
}
