import type { Command, Event } from '@cf-loom/contract';
import { brokerMessageIdOf, jsonBytesOf, messageIdentityOf } from '@cf-loom/contract/internal';
import { checkedMessageBody } from '@cf-loom/handlers/internal';
import type { OutgoingMessage } from '../broker/index.ts';
import type { PublishedVersion, SentVersion } from '../subjects/index.ts';
import { checkedHeadersOf } from './checks.ts';
import { InvalidMessageError, type InvalidPart } from './errors.ts';
import type { MessageOptions } from './types.ts';

/** A Message Version of one call and the body the calling code gave it. */
export type Given = { readonly version: PublishedVersion | SentVersion; readonly body: unknown };

/** A Message ready to leave, beside the Message Version it carries. */
export type Outgoing = { readonly version: Event | Command; readonly message: OutgoingMessage };

/** A body as its version's schema parsed it, unknown keys stripped, or why it breaks it. */
type Parsed = { readonly value: unknown; readonly invalid: readonly InvalidPart[] };

/**
 * The Messages of one call, sharing one Fact id: the Fact id, the headers, each version's header
 * bytes and each body checked in one pass, so every refused part is listed together and nothing leaves.
 */
export function outgoingOf(given: readonly Given[], options: MessageOptions): readonly Outgoing[] {
  const { factId } = options;
  const versions = given.map(({ version, body }) => ({
    version,
    messageId: brokerMessageIdOf(version.message, factId),
    parsed: parsedBodyOf(version.message, body),
  }));
  const measured = versions.map(({ version, messageId }) => ({
    version: version.message,
    messageId,
    factId,
  }));
  const checked = checkedHeadersOf({ factId }, options.headers ?? {}, measured);
  const invalid = [...checked.invalid, ...versions.flatMap(({ parsed }) => parsed.invalid)];
  if (invalid.length > 0) {
    throw new InvalidMessageError(invalid);
  }
  return versions.map(({ version, messageId, parsed }) => ({
    version: version.message,
    message: {
      subject: version.subject,
      messageId,
      factId,
      headers: checked.headers,
      body: jsonBytesOf(parsed.value),
    },
  }));
}

function parsedBodyOf(version: Event | Command, body: unknown): Parsed {
  const checked = checkedMessageBody(version.body, body);
  if (checked.kind === 'value') {
    return { value: checked.value, invalid: [] };
  }
  const identity = messageIdentityOf(version.name, version.version);
  return { value: undefined, invalid: [{ kind: 'body', identity, issues: checked.issues }] };
}
