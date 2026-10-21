import { elementNameOf, faultLineOf, issueLineOf } from '@cf-loom/handlers/internal';
import type { BrokerConsumer, ConsumedFault, Delivery } from '../broker/index.ts';

/** What hears of a `ConsumedFault`: the Service's `onServiceFault`, or the console without one. */
export type Report = (fault: ConsumedFault) => void;

/** The Service's hook, or the console line of every fault. */
export function reportOf(onServiceFault: Report | undefined): Report {
  return onServiceFault ?? logConsumedFault;
}

/** The lines a fault is told in, wherever it is told: one per Issue, or one for a Fault or a throw. */
export function consumedFaultLinesOf(fault: ConsumedFault): readonly string[] {
  const source = sourceOf(fault);
  switch (fault.kind) {
    case 'invalid-body':
      return fault.issues.map((issue) => issueLineOf(source, issue));
    case 'returned':
      return [faultLineOf(source, fault.fault)];
    case 'thrown':
      return [faultLineOf(source, { message: 'the Handler threw' })];
  }
}

/** The line for a delivery whose `receive` rejected, which only an `onServiceFault` that throws causes. */
export function receiveFailureLineOf(
  { element, subject }: Pick<BrokerConsumer, 'element' | 'subject'>,
  { messageId, factId }: Pick<Delivery, 'messageId' | 'factId'>,
): string {
  const source = sourceOf({ element: elementNameOf(element), subject, messageId, factId });
  return faultLineOf(source, { message: 'onServiceFault threw' });
}

/** A fault on the console: each of its lines, after its cause when it has one. */
function logConsumedFault(fault: ConsumedFault): void {
  const cause = causeOf(fault);
  for (const line of consumedFaultLinesOf(fault)) {
    console.error(...(cause === undefined ? [line] : [line, cause]));
  }
}

function causeOf(fault: ConsumedFault): unknown {
  switch (fault.kind) {
    case 'invalid-body':
      return undefined;
    case 'returned':
      return fault.fault.cause;
    case 'thrown':
      return fault.cause;
  }
}

/** What names a Message in a line: the Element handling it, its subject, broker message id and Fact id. */
function sourceOf({
  element,
  subject,
  messageId,
  factId,
}: Pick<ConsumedFault, 'element' | 'subject' | 'messageId' | 'factId'>): string {
  return `${element} ${subject} ${messageId} ${factId}`;
}
