import type { ReceivedHeaders } from './broker.ts';

/** The SNS message attribute a Message's subject travels in, which each Durable consumer's subscription filters on. */
export const snsSubjectAttribute = 'cf-loom-subject';

/** The SNS message attribute the Broker message id travels in. */
export const snsMessageIdAttribute = 'cf-loom-message-id';

/** The SNS message attribute the Fact id travels in. */
export const snsFactIdAttribute = 'cf-loom-fact-id';

/** The SNS message attribute the Message's Broker headers travel in. */
export const snsHeadersAttribute = 'cf-loom-headers';

/** A value's JSON text with every UTF-16 code unit outside printable ASCII written as a lower-case `\uXXXX` escape, which SNS carries in an attribute and `JSON.parse` reads back. */
function asciiJsonOf(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** The SNS message attributes a Message travels with: its prefixed subject as is, and its Broker message id, Fact id and Transport headers in ASCII JSON, which SNS carries unchanged. */
export function snsAttributesOf(message: {
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  return {
    [snsSubjectAttribute]: message.subject,
    [snsMessageIdAttribute]: asciiJsonOf(message.messageId),
    [snsFactIdAttribute]: asciiJsonOf(message.factId),
    [snsHeadersAttribute]: asciiJsonOf(message.headers),
  };
}

/** The inverse of `snsAttributesOf` for what a queue received: the Message's ids and Transport headers, or the names of cf-loom's attributes it lacks or that do not read back. */
export function receivedSnsAttributesOf(
  attributes: Readonly<Record<string, string | undefined>>,
): ReceivedHeaders {
  const names = [snsMessageIdAttribute, snsFactIdAttribute].filter(
    (name) => attributes[name] === undefined,
  );
  if (names.length > 0) {
    return { kind: 'missing', names };
  }
  return {
    kind: 'read',
    messageId: JSON.parse(attributes[snsMessageIdAttribute] ?? ''),
    factId: JSON.parse(attributes[snsFactIdAttribute] ?? ''),
    headers: Object.fromEntries(Object.entries(JSON.parse(attributes[snsHeadersAttribute] ?? ''))),
  };
}
