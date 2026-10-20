import type { Command, Subscription } from '../declarations/index.ts';
import { isSubscription } from '../declarations/index.ts';
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

/** The durable consumer of a Subscription, `<service>_<name>`, or of a Command Version, `<service>_command_<Name>_v<n>`. */
export function durableNameOf(service: string, consumed: Subscription | Command): string {
  if (isSubscription(consumed)) {
    return `${service}_${consumed.name}`;
  }
  return `${service}_command_${consumed.name}_v${consumed.version}`;
}

/** Whether a transport header would take the name of one cf-loom sets on every Message, in any case. */
export function isReservedHeader(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered === factIdHeader.toLowerCase() || lowered === brokerMessageIdHeader.toLowerCase();
}
