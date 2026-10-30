import {
  brokerHeaderBytesOf,
  isIdHeaderValue,
  maxBrokerHeaderBytes,
  type ReceivedHeaders,
  transportHeaderFitOf,
} from './broker.ts';

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

/** What an attribute's text is as JSON, or `undefined` when the attribute is absent or its text is no JSON, which no JSON text is. */
function parsedJsonOf(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The id an attribute holds as a JSON string the Fact id's rule accepts. */
function idOf(text: string | undefined): string | undefined {
  const id = parsedJsonOf(text);
  return isIdHeaderValue(id) ? id : undefined;
}

/** The Transport headers an attribute holds as a JSON object of headers the core lets travel, each an own entry whatever its name. */
function headersOf(text: string | undefined): Readonly<Record<string, string>> | undefined {
  const parsed = parsedJsonOf(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const entries = Object.entries(parsed);
  const travels = entries.every(([name, value]) => transportHeaderFitOf(name, value) === 'travels');
  return travels ? Object.fromEntries(entries) : undefined;
}

const attributeNames = [snsMessageIdAttribute, snsFactIdAttribute, snsHeadersAttribute];

/** The inverse of `snsAttributesOf` for what a queue received: the Message's ids and Transport headers, or the names of cf-loom's attributes it lacks or that do not read back. */
export function receivedSnsAttributesOf(
  attributes: Readonly<Record<string, string | undefined>>,
): ReceivedHeaders {
  const messageId = idOf(attributes[snsMessageIdAttribute]);
  const factId = idOf(attributes[snsFactIdAttribute]);
  const headers = headersOf(attributes[snsHeadersAttribute]);
  const readings = [messageId, factId, headers];
  if (messageId === undefined || factId === undefined || headers === undefined) {
    return { kind: 'missing', names: attributeNames.filter((_, at) => readings[at] === undefined) };
  }
  const read = { messageId, factId, headers };
  return brokerHeaderBytesOf(read) > maxBrokerHeaderBytes
    ? { kind: 'missing', names: attributeNames }
    : { kind: 'read', ...read };
}
