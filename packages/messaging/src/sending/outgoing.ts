import type { Command, Event } from '@cf-loom/contract';
import { brokerMessageIdOf, jsonBytesOf, messageIdentityOf } from '@cf-loom/contract/internal';
import { checkedMessageBody } from '@cf-loom/handlers/internal';
import type { OutgoingMessage } from '../broker/index.ts';
import type { PublishedVersion, SentVersion } from '../subjects/index.ts';
import { type HeaderParts, headerPartsOf, idPartsOf, sizePartsOf } from './checks.ts';
import { InvalidMessageError, type InvalidPart } from './errors.ts';
import type { MessageOptions } from './types.ts';

/** A Message Version of one call and the body the calling code gave it. */
export type Given = { readonly version: PublishedVersion | SentVersion; readonly body: unknown };

/** A Message ready to leave, beside the Message Version it carries. */
export type Outgoing = { readonly version: Event | Command; readonly message: OutgoingMessage };

/**
 * The Messages of one call, sharing one Fact id: the Fact id, the headers, each version's header
 * bytes and each body checked in one pass, so every refused part is listed together and nothing leaves.
 */
export function outgoingOf(given: readonly Given[], options: MessageOptions): readonly Outgoing[] {
  const { factId } = options;
  const { headers, invalid: refusedHeaders } = headerPartsOf(options.headers ?? {});
  const headed = given.map(({ version, body }) => {
    const parts = { messageId: brokerMessageIdOf(version.message, factId), factId, headers };
    return { version, body, parts, tooLarge: sizePartsOf(version.message, parts) };
  });
  const parsed = headed.map(({ version, body }) => parsedBodyOf(version.message, body));
  const invalid: InvalidPart[] = [
    ...idPartsOf('factId', factId),
    ...refusedHeaders,
    ...headed.flatMap(({ tooLarge }) => tooLarge),
    ...parsed.flatMap(({ invalid: refused }) => refused),
  ];
  if (invalid.length > 0) {
    throw new InvalidMessageError(invalid);
  }
  return headed.map(({ version, parts }, index) => ({
    version: version.message,
    message: messageOf(version.subject, parts, parsed[index]?.value),
  }));
}

/** A body as its version's schema parsed it, unknown keys stripped, or why it breaks it. */
function parsedBodyOf(
  version: Event | Command,
  body: unknown,
): { readonly value: unknown; readonly invalid: readonly InvalidPart[] } {
  const checked = checkedMessageBody(version.body, body);
  if (checked.kind === 'value') {
    return { value: checked.value, invalid: [] };
  }
  const identity = messageIdentityOf(version.name, version.version);
  return { value: undefined, invalid: [{ kind: 'body', identity, issues: checked.issues }] };
}

function messageOf(subject: string, parts: HeaderParts, value: unknown): OutgoingMessage {
  return { subject, ...parts, body: jsonBytesOf(value) };
}
