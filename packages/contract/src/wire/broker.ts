import { follows, kebabCase, ruleOf } from '../declarations/index.ts';
import { subjectVersionOf } from '../written/index.ts';
import { kebabCaseOf } from './identifiers.ts';

/** The header the Fact id travels in, never parsed out of the broker message id. */
export const factIdHeader = 'Cf-Loom-Fact-Id';

/** The header the broker message id travels in, which the broker deduplicates by. */
export const brokerMessageIdHeader = 'Nats-Msg-Id';

/** A Message Version's subject within its Service's stream, `<event|command>.<Name>.v<n>`, which the subject and the broker message id share. */
function streamSubjectOf(message: {
  readonly kind: 'event' | 'command';
  readonly name: string;
  readonly version: number;
}): string {
  return `${message.kind}.${subjectVersionOf(message)}`;
}

/** The subject a Message Version travels on, unprefixed: `<service>.<event|command>.<Name>.v<n>`. */
export function subjectOf(
  service: string,
  message: { readonly kind: 'event' | 'command'; readonly name: string; readonly version: number },
): string {
  return `${service}.${streamSubjectOf(message)}`;
}

/** The broker message id a Message is sent with, `<event|command>.<Name>.v<n>:<factId>`: its subject after the Service's name, so it is unique in the Service's stream, then the Fact id. */
export function brokerMessageIdOf(
  message: { readonly kind: 'event' | 'command'; readonly name: string; readonly version: number },
  factId: string,
): string {
  return `${streamSubjectOf(message)}:${factId}`;
}

/** The broker headers a Message travels with: its transport headers, its broker message id in `Nats-Msg-Id` and its Fact id in `Cf-Loom-Fact-Id`. */
export function brokerHeadersOf(message: {
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  return {
    ...message.headers,
    [brokerMessageIdHeader]: message.messageId,
    [factIdHeader]: message.factId,
  };
}

/** The most bytes a Message's broker headers may take on the wire: JetStream refuses a publish whose header block is longer, which no configuration raises. */
export const maxBrokerHeaderBytes = 65_535;

/** The bytes a Message's broker headers take as nats-core writes them and JetStream measures them: the `NATS/1.0` line, one `<name>: <value>` line each, and the blank line, in UTF-8 bytes. */
export function brokerHeaderBytesOf(message: {
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
}): number {
  const lines = Object.entries(brokerHeadersOf(message)).map(
    ([name, value]) => `${name}: ${value}\r\n`,
  );
  return new TextEncoder().encode(`NATS/1.0\r\n${lines.join('')}\r\n`).length;
}

/** A delivered Message's broker headers read back: its ids and transport headers, or the names of the cf-loom headers it lacks. */
export type ReceivedHeaders =
  | {
      readonly kind: 'read';
      readonly messageId: string;
      readonly factId: string;
      readonly headers: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'missing'; readonly names: readonly string[] };

/** The inverse of `brokerHeadersOf`: a delivered Message's ids and transport headers, or the ids it lacks. */
export function receivedHeadersOf(
  entries: readonly (readonly [string, string])[],
): ReceivedHeaders {
  const valueByName = joinedByName(entries);
  const messageId = valueByName.get(brokerMessageIdHeader) ?? '';
  const factId = valueByName.get(factIdHeader) ?? '';
  const ids: (readonly [string, string])[] = [
    [brokerMessageIdHeader, messageId],
    [factIdHeader, factId],
  ];
  const names = ids.filter(([, id]) => !isIdHeaderValue(id)).map(([name]) => name);
  if (names.length > 0) {
    return { kind: 'missing', names };
  }
  const transport = [...valueByName].filter(([name]) => !isReservedHeader(name));
  return { kind: 'read', messageId, factId, headers: Object.fromEntries(transport) };
}

/** The values of each header name joined with `, `, as an HTTP header given several times is. */
function joinedByName(entries: readonly (readonly [string, string])[]): Map<string, string> {
  const valueByName = new Map<string, string>();
  for (const [name, value] of entries) {
    const before = valueByName.get(name);
    valueByName.set(name, before === undefined ? value : `${before}, ${value}`);
  }
  return valueByName;
}

/** The stream of a Service, named after it: its own Messages travel on it, and a consumer of its Events reads it. */
export function streamNameOf(service: string): string {
  return service;
}

/** What has a durable consumer: a Subscription by its name, or a Command's Message Version. */
export type DurableConsumed =
  | { readonly kind: 'subscription'; readonly name: string }
  | { readonly kind: 'command'; readonly name: string; readonly version: number };

/** The durable consumer of a Subscription, `<service>_<name in kebab-case>`, or of a Command Version, `<service>_command_<Name>_v<n>`. */
export function durableNameOf(service: string, consumed: DurableConsumed): string {
  switch (consumed.kind) {
    case 'subscription':
      return `${service}_${kebabCaseOf(consumed.name)}`;
    case 'command':
      return `${service}_command_${consumed.name}_v${consumed.version}`;
  }
}

/** What a Broker prefix is, as every refusal of one says it: `kebab-case of at most 64 characters, such as staging`. */
export const brokerPrefixRule = `${ruleOf(kebabCase)}, such as staging`;

/** Whether a text may prefix a Broker's names: kebab-case of at most 64 characters, as a Service name, so it holds no `_`, `.`, `*` or `>`. */
export function isBrokerPrefix(text: string): boolean {
  return follows(kebabCase, text);
}

/** A subject with the prefix in front, `staging.orders-service.event.OrderCreated.v2`, or the subject itself without one. */
export function prefixedSubjectOf(prefix: string | null, subject: string): string {
  return prefix === null ? subject : `${prefix}.${subject}`;
}

/** A stream's or durable consumer's name with the prefix in front, `staging_orders-service`, or the name itself without one. */
export function prefixedNameOf(prefix: string | null, name: string): string {
  return prefix === null ? name : `${prefix}_${name}`;
}

/** Whether a name carries the prefix `prefixedNameOf` puts in front of it; any name does without a prefix. */
export function isPrefixedName(prefix: string | null, name: string): boolean {
  return name.startsWith(prefixedNameOf(prefix, ''));
}

/** Whether a subject carries the prefix `prefixedSubjectOf` puts in front of it; any subject does without a prefix. */
export function isPrefixedSubject(prefix: string | null, subject: string): boolean {
  return subject.startsWith(prefixedSubjectOf(prefix, ''));
}

/** Whether a transport header reaches every Broker as given, or why not: a name cf-loom or NATS reserves, a name NATS cannot carry, or a value NATS would not carry as given. */
export type TransportHeaderFit = 'travels' | 'reserved-name' | 'uncarried-name' | 'uncarried-value';

/** How a transport header fares over the Broker, so the core refuses one NATS would act on, refuse or change. */
export function transportHeaderFitOf(name: string, value: unknown): TransportHeaderFit {
  if (isReservedHeader(name)) {
    return 'reserved-name';
  }
  if (!isCarriedName(name)) {
    return 'uncarried-name';
  }
  return isCarriedValue(value) ? 'travels' : 'uncarried-value';
}

/** Whether NATS carries a header name: one or more visible ASCII characters but the colon. */
function isCarriedName(name: string): boolean {
  return /^[\x21-\x39\x3b-\x7e]+$/.test(name);
}

/** Whether a text can be a Fact id or a broker message id: a non-empty header value NATS carries unchanged. */
export function isIdHeaderValue(text: unknown): text is string {
  return isCarriedValue(text) && text !== '';
}

/** Whether NATS carries a header value unchanged: a string with no CR or LF, no whitespace at either end for `trim` and no lone surrogate. */
function isCarriedValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !/[\r\n]/.test(value) &&
    value.trim() === value &&
    value.isWellFormed()
  );
}

/** Whether a transport header would take a name in the namespace of cf-loom's headers or of NATS's, in any case. */
function isReservedHeader(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered.startsWith('cf-loom-') || lowered.startsWith('nats-');
}
