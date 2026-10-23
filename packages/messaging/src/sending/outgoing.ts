import type { Command, Event } from '@cf-loom/contract';
import {
  brokerHeaderBytesOf,
  brokerMessageIdOf,
  isIdHeaderValue,
  jsonBytesOf,
  maxBrokerHeaderBytes,
  messageIdentityOf,
  type TransportHeaderFit,
  transportHeaderFitOf,
} from '@cf-loom/contract/internal';
import { checkedMessageBody } from '@cf-loom/handlers/internal';
import type { OutgoingMessage } from '../broker/index.ts';
import type { PublishedVersion, SentVersion } from '../subjects/index.ts';
import { type InvalidBody, InvalidMessageError } from './errors.ts';
import type { MessageOptions } from './types.ts';

/** A Message Version of one call and the body the calling code gave it. */
export type Given = { readonly version: PublishedVersion | SentVersion; readonly body: unknown };

/** The parts of a Message its broker headers are written from. */
type HeaderParts = Pick<OutgoingMessage, 'messageId' | 'factId' | 'headers'>;

/** A Message Version of one call, the body the calling code gave it and its checked header parts. */
type Headed = Given & { readonly parts: HeaderParts };

/** A body as its version's schema parsed it. */
type Parsed = {
  readonly version: Given['version'];
  readonly value: unknown;
  readonly parts: HeaderParts;
};

/** A Message ready to leave, beside the Message Version it carries. */
export type Outgoing = { readonly version: Event | Command; readonly message: OutgoingMessage };

/**
 * The Messages of one call, sharing one Fact id: every Message's broker headers and every body
 * checked before any is built, so a refused one throws and nothing leaves.
 */
export function outgoingOf(
  given: readonly Given[],
  options: MessageOptions = {},
): readonly Outgoing[] {
  const factId = factIdOf(options.factId);
  const headers = transportHeadersOf(options.headers ?? {});
  const headed = given.map(({ version, body }) => {
    const messageId = brokerMessageIdOf(version.message, factId);
    const parts = checkedHeaderPartsOf(version.message, { messageId, factId, headers });
    return { version, body, parts };
  });
  return parsedBodiesOf(headed).map(({ version, value, parts }) => ({
    version: version.message,
    message: { subject: version.subject, ...parts, body: jsonBytesOf(value) },
  }));
}

/** Every body parsed with its version's schema, unknown keys stripped; any that breaks it throws. */
function parsedBodiesOf(headed: readonly Headed[]): readonly Parsed[] {
  const parsed: Parsed[] = [];
  const invalid: InvalidBody[] = [];
  for (const { version, body, parts } of headed) {
    const checked = checkedMessageBody(version.message.body, body);
    if (checked.kind === 'value') {
      parsed.push({ version, value: checked.value, parts });
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

/** The Fact id given, which travels in a header and the broker message id as given on every Broker, or a random one. */
export function factIdOf(given: string | undefined): string {
  if (given === undefined) {
    return globalThis.crypto.randomUUID();
  }
  return checkedIdOf('Fact id', given);
}

/** The id given, which travels in a header, or a throw that names what the id is and what makes one. */
export function checkedIdOf(kind: 'Fact id' | 'broker message id', given: string): string {
  if (!isIdHeaderValue(given)) {
    throw new Error(
      `A ${kind} is a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate`,
    );
  }
  return given;
}

/** A Message's ids and transport headers, unchanged, or a throw naming its Message Version when its broker headers would take more bytes than JetStream stores. */
export function checkedHeaderPartsOf(version: Event | Command, parts: HeaderParts): HeaderParts {
  const bytes = brokerHeaderBytesOf(parts);
  if (bytes > maxBrokerHeaderBytes) {
    const identity = messageIdentityOf(version.name, version.version);
    throw new Error(
      `The broker headers of ${identity} would take ${bytes} bytes, over the ${maxBrokerHeaderBytes} JetStream stores; the Fact id counts twice, in Cf-Loom-Fact-Id and in Nats-Msg-Id`,
    );
  }
  return parts;
}

/** The transport headers as given, each one reaching every Broker unchanged. */
export function transportHeadersOf(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  for (const [name, value] of Object.entries(headers)) {
    const fit = transportHeaderFitOf(name, value);
    if (fit !== 'travels') {
      throw new Error(refusalOf(name, fit));
    }
  }
  return { ...headers };
}

function refusalOf(name: string, fit: Exclude<TransportHeaderFit, 'travels'>): string {
  switch (fit) {
    case 'reserved-name':
      return `The transport header ${name} takes a name cf-loom or NATS reserves: any starting with Cf-Loom- or Nats-`;
    case 'uncarried-name':
      return `The transport header name ${JSON.stringify(name)} cannot travel over NATS: it is empty or holds a colon, a space, a control or a non-ASCII character`;
    case 'uncarried-value':
      return `The transport header ${name} has a value that would not arrive as given over NATS: not a string, a CR or LF, whitespace leading or trailing, or a lone surrogate`;
  }
}
