import type { Command, Subscription } from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import { checkedBody, type Issue } from '../checks/index.ts';
import { type Fault, isFault } from '../outcomes/index.ts';
import { elementNameOf } from './errors.ts';
import { describedOf } from './implementation.ts';
import type { Written } from './run.ts';

/** What a Message Handler was written with: its Command or Subscription, the Reader schema it reads a body with, its implementation, and whether it is a stub. */
export type MessageWritten = Written<Command | Subscription> & { readonly reader: core.$ZodType };

/** What a Message Handler receives beside its body: the Message's ids, which attempt this is, and the transport headers it was published with. */
export type MessageMeta = {
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  readonly headers: Readonly<Record<string, string>>;
};

/** What one call of a Message Handler is given: its body as a Subscriber reads it, and its meta. */
export type MessageGiven = { readonly body: unknown; readonly meta: MessageMeta };

/** How one call of a Message Handler went: given a body that breaks its Reader, threw, or answered nothing or a Fault. */
export type MessageRun =
  | { readonly kind: 'invalid-input'; readonly issues: readonly Issue[] }
  | { readonly kind: 'thrown'; readonly cause: unknown }
  | { readonly kind: 'answered'; readonly answer: Fault | undefined };

/**
 * Runs one call of a Message Handler: reads its body with its Reader, then runs it. It never throws:
 * anything thrown, or a return that is neither nothing nor a Fault, is `thrown`.
 */
export async function messageRunOf(
  written: MessageWritten,
  given: MessageGiven,
): Promise<MessageRun> {
  try {
    return await messageCallOf(written, given);
  } catch (e) {
    return { kind: 'thrown', cause: e };
  }
}

async function messageCallOf(
  { element, reader, implementation }: MessageWritten,
  { body, meta }: MessageGiven,
): Promise<MessageRun> {
  const checked = checkedBody(reader, body);
  if (checked.kind === 'issues') {
    return { kind: 'invalid-input', issues: checked.issues };
  }
  const returned = await implementation(checked.value, meta);
  if (returned === undefined || isFault(returned)) {
    return { kind: 'answered', answer: returned };
  }
  const message = `${elementNameOf(element)}'s Handler returned no Fault but ${describedOf(returned)}`;
  return { kind: 'thrown', cause: new TypeError(message) };
}
