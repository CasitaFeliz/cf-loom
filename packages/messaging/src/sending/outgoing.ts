import type { Command, Event } from '@cf-loom/contract';
import { brokerMessageIdOf, isReservedHeader, messageIdentityOf } from '@cf-loom/contract/internal';
import { checkedMessageBody } from '@cf-loom/handlers/internal';
import type { OutgoingMessage } from '../broker/index.ts';
import type { PublishedVersion, SentVersion } from '../subjects/index.ts';
import { type InvalidBody, InvalidMessageError } from './errors.ts';
import type { MessageOptions } from './types.ts';

/** A Message Version of one call and the body the calling code gave it. */
export type Given = { readonly version: PublishedVersion | SentVersion; readonly body: unknown };

/** A body as its version's schema parsed it. */
type Parsed = { readonly version: Given['version']; readonly value: unknown };

/** A Message ready to leave, beside the Message Version it carries. */
export type Outgoing = { readonly version: Event | Command; readonly message: OutgoingMessage };

/**
 * The Messages of one call, sharing one Fact id: every body checked with its version's schema
 * before any is built, so an invalid one throws and nothing leaves.
 */
export function outgoingOf(
  given: readonly Given[],
  options: MessageOptions = {},
): readonly Outgoing[] {
  const factId = factIdOf(options.factId);
  const headers = transportHeadersOf(options.headers ?? {});
  return parsedBodiesOf(given).map(({ version, value }) => ({
    version: version.message,
    message: {
      subject: version.subject,
      messageId: brokerMessageIdOf(version.message, factId),
      factId,
      headers,
      body: new TextEncoder().encode(JSON.stringify(value)),
    },
  }));
}

/** Every body parsed with its version's schema, unknown keys stripped; any that breaks it throws. */
function parsedBodiesOf(given: readonly Given[]): readonly Parsed[] {
  const parsed: Parsed[] = [];
  const invalid: InvalidBody[] = [];
  for (const { version, body } of given) {
    const checked = checkedMessageBody(version.message.body, body);
    if (checked.kind === 'value') {
      parsed.push({ version, value: checked.value });
      continue;
    }
    const identity = messageIdentityOf(version.message.name, version.message.version);
    invalid.push({ identity, issues: checked.issues });
  }
  if (invalid.length > 0) {
    throw new InvalidMessageError(invalid);
  }
  return parsed;
}

/** The Fact id given, which travels in a header and the broker message id, or a random one. */
function factIdOf(given: string | undefined): string {
  if (given === undefined) {
    return globalThis.crypto.randomUUID();
  }
  if (typeof given !== 'string' || given === '') {
    throw new Error('A Fact id is a non-empty string');
  }
  return given;
}

/** The transport headers as given, none of them taking a name cf-loom sets itself. */
function transportHeadersOf(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const reserved = Object.keys(headers).find(isReservedHeader);
  if (reserved !== undefined) {
    throw new Error(`The transport header ${reserved} takes a name cf-loom sets itself`);
  }
  return { ...headers };
}
