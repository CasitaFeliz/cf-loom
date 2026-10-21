import { messageIdentityOf, type ProvidedEvent } from '@cf-loom/contract/internal';
import { checkedBody } from '@cf-loom/handlers/internal';
import type * as core from 'zod/v4/core';
import { mistakeOf } from '../mistakes/index.ts';

/**
 * Builds the body of a Provider's Event as its Subscribers read it: written back through the
 * Event's Reader schema and read with it again, so a test never hands a Handler what the Provider
 * could not send.
 */
export function fakeEvent<Faked extends ProvidedEvent>(
  event: Faked,
  body: core.output<Faked['body']>,
): core.output<Faked['body']> {
  const messageVersion = messageIdentityOf(event.name, event.version);
  const checked = checkedOrMistake(event.body, body, messageVersion);
  if (checked.kind === 'issues') {
    const what = 'the faked body breaks its Reader';
    throw mistakeOf({ provider: messageVersion, what, issues: checked.issues });
  }
  return checked.value as core.output<Faked['body']>;
}

/** The body checked against the Event's Reader; whatever throws while it is read is the test's mistake. */
function checkedOrMistake(
  reader: core.$ZodType,
  body: unknown,
  messageVersion: string,
): ReturnType<typeof checkedBody> {
  try {
    return checkedBody(reader, body);
  } catch (e) {
    const what = 'the faked body cannot be read';
    throw mistakeOf({ provider: messageVersion, what, cause: e });
  }
}
