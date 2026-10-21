import type { Event } from '@cf-loom/contract';
import { messageIdentityOf } from '@cf-loom/contract/internal';
import { checkedBody } from '@cf-loom/handlers/internal';
import type * as core from 'zod/v4/core';
import { mistakeOf } from '../mistakes/index.ts';

/**
 * Builds the body of a Provider's Event as its Subscribers read it: written back through the
 * Event's Reader schema and read with it again, so a test never hands a Handler what the Provider
 * could not send.
 */
export function fakeEvent<const Faked extends Event & { readonly visibility: 'internal' }>(
  event: Faked,
  body: core.output<Faked['body']>,
): core.output<Faked['body']> {
  const provider = messageIdentityOf(event.name, event.version);
  const checked = checkedOrMistake(event, body, provider);
  if (checked.kind === 'issues') {
    throw mistakeOf({ provider, what: 'the faked body breaks its Reader', issues: checked.issues });
  }
  return checked.value as core.output<Faked['body']>;
}

/** The body checked against the Event's Reader; whatever throws while it is read is the test's mistake. */
function checkedOrMistake(
  event: Event,
  body: unknown,
  provider: string,
): ReturnType<typeof checkedBody> {
  try {
    return checkedBody(event.body, body);
  } catch (e) {
    throw mistakeOf({ provider, what: 'the faked body cannot be read', cause: e });
  }
}
