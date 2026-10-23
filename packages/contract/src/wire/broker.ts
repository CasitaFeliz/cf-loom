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

/** Whether a transport header would take the name of one cf-loom sets on every Message, in any case. */
export function isReservedHeader(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered === factIdHeader.toLowerCase() || lowered === brokerMessageIdHeader.toLowerCase();
}
