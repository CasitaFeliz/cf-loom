import type { Command, Subscription } from '@cf-loom/contract';
import { listedIssueLinesOf, logOf } from '@cf-loom/contract/internal';
import type { Issue } from '@cf-loom/handlers';
import {
  failureCauseOf,
  failureLineOf,
  type HandlerFailure,
  type HandlerFaultBase,
  hookFailureOf,
  nameOf,
} from '@cf-loom/handlers/internal';
import type { Delivery } from '../broker/index.ts';
import type { Consumed } from '../subjects/index.ts';
import { messageWordsOf } from './message-words.ts';

/**
 * What a Message Handler ended or failed with, which `onServiceFault` receives: the Subscription or
 * the Command's Message Version it handles as `declaration`, with its `name`, a Command's as `ChargeCard@1`,
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

/** Called with each Fault a Message Handler produced; what it returns is awaited, then ignored. */
export type ServiceFaultHook = (fault: ConsumedFault) => unknown;

/** Tells of a fault and never rejects: it answers the `onServiceFault threw` line when the hook failed. */
export type Report = (fault: ConsumedFault) => Promise<string | undefined>;

/** The Service's hook, contained so that its failure is logged and answered, or the console line of every fault. */
export function reportOf(onServiceFault: ServiceFaultHook | undefined): Report {
  if (onServiceFault === undefined) {
    return async (fault) => {
      logConsumedFault(fault);
      return undefined;
    };
  }
  return async (fault) => {
    const called = { source: sourceOf(fault), hook: 'onServiceFault' } as const;
    return await hookFailureOf(onServiceFault, fault, called);
  };
}

/** The lines a fault is told in, wherever it is told: its Issues listed and counted, or one line for a Fault or a throw. */
export function consumedFaultLinesOf(fault: ConsumedFault): readonly string[] {
  const source = sourceOf(fault);
  switch (fault.kind) {
    case 'invalid-body':
      return listedIssueLinesOf(source, fault.issues);
    case 'returned':
    case 'thrown':
      return [failureLineOf(source, fault)];
  }
}

/** What a fault says of where it came from: the declaration handled, the Message and which attempt. */
export type About = Pick<
  ConsumedFault,
  'declaration' | 'name' | 'subject' | 'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt'
>;

/** The delivery a fault speaks of: the Message's ids and which attempt. */
type Delivered = Pick<Delivery, 'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt'>;

/** Where a delivery went: the declaration its Durable consumer handles, its subject, the Message's ids and which attempt. */
export function aboutOf(
  { declaration, subject }: Pick<Consumed, 'declaration' | 'subject'>,
  { messageId, factId, deliveryCount, lastAttempt }: Delivered,
): About {
  const name = nameOf(declaration);
  return { declaration, name, subject, messageId, factId, deliveryCount, lastAttempt };
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

/** What names a Message in a line: its words, then the attempt, the last one marked. */
function sourceOf(about: About): string {
  const { deliveryCount, lastAttempt } = about;
  const attempt = lastAttempt ? `attempt ${deliveryCount}, the last` : `attempt ${deliveryCount}`;
  return `${messageWordsOf(about)} ${attempt}`;
}
