import { follows, kebabCase } from '../validation/index.ts';
import { subjectVersionOf } from '../written/index.ts';

/** The header the Fact id travels in, never parsed out of the broker message id. */
const factIdHeader = 'Cf-Loom-Fact-Id';

/** The header the broker message id travels in, which the broker deduplicates by. */
const brokerMessageIdHeader = 'Nats-Msg-Id';

/** The subject a Message Version travels on, unprefixed: `<service>.<event|command>.<Name>.v<n>`. */
export function subjectOf(
  service: string,
  message: { readonly kind: 'event' | 'command'; readonly name: string; readonly version: number },
): string {
  return `${service}.${message.kind}.${subjectVersionOf(message)}`;
}

/** The broker message id a Message is sent with, `<Name>.v<n>:<factId>`, unique in its stream since a name has one kind. */
export function brokerMessageIdOf(
  message: { readonly name: string; readonly version: number },
  factId: string,
): string {
  return `${subjectVersionOf(message)}:${factId}`;
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
  const names = ids.filter(([, id]) => id === '').map(([name]) => name);
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

/** The durable consumer of a Subscription, `<service>_<name>`, or of a Command Version, `<service>_command_<Name>_v<n>`. */
export function durableNameOf(service: string, consumed: DurableConsumed): string {
  switch (consumed.kind) {
    case 'subscription':
      return `${service}_${consumed.name}`;
    case 'command':
      return `${service}_command_${consumed.name}_v${consumed.version}`;
  }
}

/** Whether a text may prefix a Broker's names: kebab-case, as a Service name, so it holds no `_`, `.`, `*` or `>`. */
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

/** Whether a transport header reaches every Broker as given, or why not: a name cf-loom or NATS reserves. */
export type TransportHeaderFit = 'travels' | 'reserved-name';

/** How a transport header fares over the Broker, so the core refuses one NATS would act on, refuse or change. */
export function transportHeaderFitOf(name: string, _value: unknown): TransportHeaderFit {
  return isReservedHeader(name) ? 'reserved-name' : 'travels';
}

/** Whether a transport header would take a name in the namespace of cf-loom's headers or of NATS's, in any case. */
export function isReservedHeader(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered.startsWith('cf-loom-') || lowered.startsWith('nats-');
}
