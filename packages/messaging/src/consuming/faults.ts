import {
  elementNameOf,
  faultLineOf,
  hookThrewLineOf,
  issueLineOf,
  logOf,
} from '@cf-loom/handlers/internal';
import type { BrokerConsumer, ConsumedFault, Delivery } from '../broker/index.ts';

/** What hears of a `ConsumedFault`, and is awaited: the Service's `onServiceFault`, or the console without one. */
export type Report = (fault: ConsumedFault) => void | Promise<void>;

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

/** What a fault says of where it came from: the Element handled and the Message. */
export type About = Pick<
  ConsumedFault,
  'element' | 'identity' | 'subject' | 'messageId' | 'factId'
>;

/** Where a delivery went: the Element its consumer handles, its subject and the Message's ids. */
export function aboutOf(
  { element, subject }: Pick<BrokerConsumer, 'element' | 'subject'>,
  { messageId, factId }: Pick<Delivery, 'messageId' | 'factId'>,
): About {
  return { element, identity: elementNameOf(element), subject, messageId, factId };
}

/** The line for a delivery whose `receive` rejected, which only an `onServiceFault` that throws or rejects causes. */
export function receiveFailureLineOf(
  consumer: Pick<BrokerConsumer, 'element' | 'subject'>,
  delivery: Pick<Delivery, 'messageId' | 'factId'>,
): string {
  const source = sourceOf(aboutOf(consumer, delivery));
  return hookThrewLineOf(source, 'onServiceFault');
}

/** A fault on the console: each of its lines, then its cause when it has one. */
function logConsumedFault(fault: ConsumedFault): void {
  for (const line of consumedFaultLinesOf(fault)) {
    console.error(...logOf(line, causeOf(fault)));
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
function sourceOf({ identity, subject, messageId, factId }: About): string {
  return `${identity} ${subject} ${messageId} ${factId}`;
}
