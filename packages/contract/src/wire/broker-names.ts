import {
  follows,
  isMessageVersion,
  messageNameGrammar,
  serviceNameGrammar,
  subscriptionNameGrammar,
} from '../declarations/index.ts';
import {
  type DurableConsumed,
  durableNameOf,
  prefixedNameOf,
  prefixedSubjectOf,
  streamNameOf,
  subjectOf,
} from './broker.ts';
import type { RoutedMessage } from './broker-needs.ts';

/** The text after the prefix `prefixedNameOf` puts in front of a name, or `undefined` when it does not carry it. */
export function unprefixedNameOf(prefix: string | null, name: string): string | undefined {
  const head = prefixedNameOf(prefix, '');
  return name.startsWith(head) ? name.slice(head.length) : undefined;
}

/** The text after the prefix `prefixedSubjectOf` puts in front of a subject, or `undefined` when it does not carry it. */
export function unprefixedSubjectOf(prefix: string | null, subject: string): string | undefined {
  const head = prefixedSubjectOf(prefix, '');
  return subject.startsWith(head) ? subject.slice(head.length) : undefined;
}

/** The Service whose Stream an unprefixed name is, when `streamNameOf` prints it from a Service name. */
export function readStreamName(name: string): { readonly service: string } | undefined {
  const service = name;
  return follows(serviceNameGrammar, service) && streamNameOf(service) === name
    ? { service }
    : undefined;
}

/** The Service and what it consumes, when `durableNameOf` prints an unprefixed name from names the grammars accept. */
export function readDurableName(
  name: string,
): { readonly service: string; readonly consumed: DurableConsumed } | undefined {
  const separator = name.indexOf('_');
  if (separator < 0) {
    return undefined;
  }
  const service = name.slice(0, separator);
  const consumed = consumedOf(name.slice(separator + 1));
  if (consumed === undefined || !follows(serviceNameGrammar, service)) {
    return undefined;
  }
  return durableNameOf(service, consumed) === name ? { service, consumed } : undefined;
}

/** A name `kebabCaseOf` makes `-x` of each capital, or a Command Version's `command_<Name>_v<n>`, read back; the caller prints it again to check it. */
function consumedOf(text: string): DurableConsumed | undefined {
  const command = /^command_([^_]+)_v([^_]+)$/.exec(text);
  if (command !== null) {
    const [, name = '', digits = ''] = command;
    const version = Number(digits);
    return follows(messageNameGrammar, name) && isMessageVersion(version)
      ? { kind: 'command', name, version }
      : undefined;
  }
  const name = text.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return follows(subscriptionNameGrammar, name) ? { kind: 'subscription', name } : undefined;
}

/** The Service and Message Version, when `subjectOf` prints an unprefixed subject from names the grammars accept. */
export function readSubject(
  subject: string,
): ({ readonly service: string } & RoutedMessage) | undefined {
  const [service = '', kind = '', name = '', version = '', ...more] = subject.split('.');
  const number = Number(version.startsWith('v') ? version.slice(1) : '');
  const isUnread =
    more.length > 0 ||
    !isRoutedKind(kind) ||
    !isMessageVersion(number) ||
    !follows(serviceNameGrammar, service) ||
    !follows(messageNameGrammar, name);
  if (isUnread) {
    return undefined;
  }
  const read = { service, kind, name, version: number };
  return subjectOf(service, read) === subject ? read : undefined;
}

function isRoutedKind(kind: string): kind is 'event' | 'command' {
  return kind === 'event' || kind === 'command';
}
