import type { Command, Subscription } from '@cf-loom/contract';
import type { Issue } from '@cf-loom/handlers';
import {
  elementNameOf,
  failureCauseOf,
  failureLineOf,
  type HandlerFailure,
  type HandlerFaultBase,
  hookFailureOf,
  hookThrewLineOf,
  issueLineOf,
  logOf,
} from '@cf-loom/handlers/internal';
import type { Delivery } from '../broker/index.ts';
import type { Consumed } from '../subjects/index.ts';

/**
 * What a Message Handler ended or failed with, which `onServiceFault` receives: the Subscription or
 * the Command's Message Version it handles as `element`, with its name or identity as `identity`,
 * the Message, then why.
 */
export type ConsumedFault = HandlerFaultBase<Command | Subscription> & {
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  /** Whether the Broker will not deliver the Message again. */
  readonly lastAttempt: boolean;
} & ({ readonly kind: 'invalid-body'; readonly issues: readonly Issue[] } | HandlerFailure);

/** The Service's `onServiceFault`, which may be async and is awaited. */
export type ServiceFaultHook = (fault: ConsumedFault) => void | Promise<void>;

/** An `onServiceFault` that threw or rejected: its `onServiceFault threw` line, already on the console, and what it threw. */
export type HookFailure = { readonly line: string; readonly cause: unknown };

/** Tells of a fault and never rejects: it answers how the hook failed, if it did. */
export type Report = (fault: ConsumedFault) => Promise<HookFailure | undefined>;

/** The Service's hook, contained so that its failure is logged and answered, or the console line of every fault. */
export function reportOf(onServiceFault: ServiceFaultHook | undefined): Report {
  if (onServiceFault === undefined) {
    return async (fault) => {
      logConsumedFault(fault);
      return undefined;
    };
  }
  return async (fault) => {
    const source = sourceOf(fault);
    const called = { source, hook: 'onServiceFault' } as const;
    const failure = await hookFailureOf(onServiceFault, fault, called);
    if (failure === undefined) {
      return undefined;
    }
    return { line: hookThrewLineOf(source, 'onServiceFault'), cause: failure.cause };
  };
}

/** The lines a fault is told in, wherever it is told: one per Issue, or one for a Fault or a throw. */
export function consumedFaultLinesOf(fault: ConsumedFault): readonly string[] {
  const source = sourceOf(fault);
  switch (fault.kind) {
    case 'invalid-body':
      return fault.issues.map((issue) => issueLineOf(source, issue));
    case 'returned':
    case 'thrown':
      return [failureLineOf(source, fault)];
  }
}

/** What a fault says of where it came from: the Element handled, the Message and which attempt. */
export type About = Pick<
  ConsumedFault,
  'element' | 'identity' | 'subject' | 'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt'
>;

/** The delivery a fault speaks of: the Message's ids and which attempt. */
type Delivered = Pick<Delivery, 'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt'>;

/** Where a delivery went: the Element its consumer handles, its subject, the Message's ids and which attempt. */
export function aboutOf(
  { element, subject }: Pick<Consumed, 'element' | 'subject'>,
  { messageId, factId, deliveryCount, lastAttempt }: Delivered,
): About {
  const identity = elementNameOf(element);
  return { element, identity, subject, messageId, factId, deliveryCount, lastAttempt };
}

/** The `onServiceFault threw` line of a delivery, which `settled()` also reports for a `receive` that rejected, through a bug. */
export function receiveFailureLineOf(
  consumed: Pick<Consumed, 'element' | 'subject'>,
  delivery: Delivered,
): string {
  const source = sourceOf(aboutOf(consumed, delivery));
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
    case 'thrown':
      return failureCauseOf(fault);
  }
}

/** What names a Message in a line: the Element handling it, its subject, broker message id, Fact id and attempt, the last one marked. */
export function sourceOf(about: About): string {
  const { identity, subject, messageId, factId, deliveryCount, lastAttempt } = about;
  const attempt = lastAttempt ? `attempt ${deliveryCount}, the last` : `attempt ${deliveryCount}`;
  return `${identity} ${subject} ${messageId} ${factId} ${attempt}`;
}
