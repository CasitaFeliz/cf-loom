import type * as core from 'zod/v4/core';
import type { Checked, Issue } from '../checks/index.ts';
import { type Fault, isFault } from '../outcomes/index.ts';
import type { MessageHandled } from './handled.ts';
import { returnedOf } from './implementation.ts';
import type { Pairing } from './pairing.ts';
import type { Written } from './run.ts';

/** What a Message Handler was written with: its Command or Subscription, the pairing that gives the Reader schema it reads a body with, its implementation, and whether it is a Stub. */
export type MessageWritten = Written<MessageHandled> & { readonly pairing: Pairing };

/** What a Message Handler receives beside its body: the Message's ids, which attempt this is, whether it is the last, the transport headers it was published with, and the signal that tells it to stop. */
export type MessageMeta = {
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  /** Whether the Broker will not deliver this Message again, so a retryable Fault or a throw is its last. */
  readonly lastAttempt: boolean;
  readonly headers: Readonly<Record<string, string>>;
  /** Aborts when messaging starts closing, its reason a `MessagingClosedError`, or when the delivery's wait passes, its reason a `DeadlineError`; past either, the Handler's answer may no longer be waited for. */
  readonly signal: AbortSignal;
};

/** What one call of a Message Handler is given: its body as a Subscriber reads it, its meta, and its Resources, which are passed on unchecked. */
export type MessageGiven = {
  readonly body: unknown;
  readonly meta: MessageMeta;
  readonly resources: unknown;
};

/** How one call of a Message Handler went: given a body that breaks its Reader, threw, or answered nothing or a Fault. */
export type MessageRun =
  | { readonly kind: 'invalid-call'; readonly issues: readonly Issue[] }
  | { readonly kind: 'thrown'; readonly cause: unknown }
  | { readonly kind: 'answered'; readonly answer: Fault | undefined };

/** How a run reads its body with its Reader: as a direct call is given it, or as `consume` receives it. */
export type BodyReading = (reader: core.$ZodType, body: unknown) => Checked<unknown>;

/**
 * Runs one call of a Message Handler: reads its body with its Reader, then runs it. It never throws:
 * anything thrown, or a return that is neither nothing nor a Fault, is `thrown`.
 */
export async function messageRunOf(
  written: MessageWritten,
  given: MessageGiven,
  readBody: BodyReading,
): Promise<MessageRun> {
  try {
    return await messageCallOf(written, given, readBody);
  } catch (e) {
    return { kind: 'thrown', cause: e };
  }
}

async function messageCallOf(
  { declaration, pairing, implementation }: MessageWritten,
  { body, meta, resources }: MessageGiven,
  readBody: BodyReading,
): Promise<MessageRun> {
  const checked = readBody(pairing.reader, body);
  if (checked.kind === 'issues') {
    return { kind: 'invalid-call', issues: checked.issues };
  }
  const run = () => implementation(checked.value, meta, { resources });
  const returned = await returnedOf(declaration, run, isAnswered);
  if (returned.kind === 'not-built') {
    return { kind: 'thrown', cause: returned.cause };
  }
  return { kind: 'answered', answer: returned.built };
}

/** Whether a Message Handler returned what it may: nothing, which acknowledges, or a Fault. */
function isAnswered(value: unknown): value is Fault | undefined {
  return value === undefined || isFault(value);
}
