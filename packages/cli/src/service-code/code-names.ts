import { byCodePoint, codeNameOf, messageOfCodeName } from '@cf-loom/contract/internal';
import type { Handled, MessageHandled } from './handled.ts';

/** A Message Version by its name and version. */
export type MessageVersion = { readonly name: string; readonly version: number };

/**
 * The name a Command's Message Version or a Subscription is paired under, which its Stub imports:
 * `chargeCardV1`, `notifyOnSettled`.
 */
export function pairingNameOf(handled: MessageHandled): string {
  switch (handled.kind) {
    case 'command':
      return codeNameOf(handled);
    case 'subscription':
      return handled.name;
  }
}

/** Orders Message Versions by name in code, as the Handler map, the readers table and the Readers list them. */
export function byNameInCode(left: MessageVersion, right: MessageVersion): number {
  return byCodePoint(codeNameOf(left), codeNameOf(right));
}

/** The name of an own Message Version's Reader schema: `orderCreatedReaderV2`. */
export function readerNameOf(message: MessageVersion): string {
  return codeNameOf(message, 'Reader');
}

type HandlerKind = Handled['kind'];

type SuffixedKind = Exclude<HandlerKind, 'command'>;

/**
 * What ends the Handler map's local name of a Handler that carries no version, by kind, so locals
 * of two kinds never meet.
 */
const localSuffixes: Readonly<Record<SuffixedKind, string>> = {
  endpoint: 'EndpointHandler',
  guard: 'GuardHandler',
  subscription: 'SubscriptionHandler',
};

const suffixedKinds = Object.keys(localSuffixes).filter(isSuffixedKind);

function isSuffixedKind(key: string): key is SuffixedKind {
  return Object.hasOwn(localSuffixes, key);
}

/** The Handler map's local name of a Handler: its name in code with its kind's word, the version last. */
export function handlerLocalOf(handled: Handled): string {
  switch (handled.kind) {
    case 'command':
      return codeNameOf(handled, 'CommandHandler');
    case 'endpoint':
    case 'guard':
    case 'subscription':
      return `${nameInCodeOf(handled)}${localSuffixes[handled.kind]}`;
  }
}

/** The kind and the name in code a Handler map's local name was made of. */
export type LocalParts = { readonly kind: HandlerKind; readonly name: string };

/** What a local name was made of, or nothing when it is no Handler's; the inverse of `handlerLocalOf`. */
export function localPartsOf(local: string): LocalParts | undefined {
  const command = messageOfCodeName(local, 'CommandHandler');
  if (command !== undefined) {
    return { kind: 'command', name: codeNameOf(command) };
  }
  for (const kind of suffixedKinds) {
    const suffix = localSuffixes[kind];
    if (local.endsWith(suffix) && local.length > suffix.length) {
      return { kind, name: local.slice(0, -suffix.length) };
    }
  }
  return undefined;
}

/** The name in code a Handler is keyed under in the Handler map: `getOrder`, `chargeCardV1`. */
export function nameInCodeOf(handled: Handled): string {
  switch (handled.kind) {
    case 'endpoint':
    case 'guard':
      return handled.name;
    case 'command':
    case 'subscription':
      return pairingNameOf(handled);
  }
}

/**
 * The name the readers file imports a Command's Message Version or a Subscription under, with its
 * kind's word so it never meets a Reader, a def or another kind's import: `chargeCardCommandV1`.
 */
export function importAliasOf(handled: MessageHandled): string {
  switch (handled.kind) {
    case 'command':
      return codeNameOf(handled, 'Command');
    case 'subscription':
      return `${pairingNameOf(handled)}Subscription`;
  }
}
