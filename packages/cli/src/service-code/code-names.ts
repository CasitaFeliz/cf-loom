import { byCodePoint, codeNameOf } from '@cf-loom/contract/internal';
import type { Handled, MessageHandled } from './handled.ts';

/** A Message Version by its name and version. */
export type MessageVersion = { readonly name: string; readonly version: number };

/**
 * The name a Command's Message Version or a Subscription is paired under, which its stub imports:
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

/** Orders Commands' Message Versions by name in code, as the Handler map and the readers list them. */
export function byCommandName(left: MessageVersion, right: MessageVersion): number {
  return byCodePoint(codeNameOf(left), codeNameOf(right));
}

/** The name of an own Message Version's Reader schema: `orderCreatedV2Reader`. */
export function readerNameOf(message: MessageVersion): string {
  return `${codeNameOf(message)}Reader`;
}

/** The Handler map's local name of a Handler, suffixed by its kind, so locals of two kinds never meet. */
export function handlerLocalOf(handled: Handled): string {
  switch (handled.kind) {
    case 'endpoint':
      return `${handled.name}EndpointHandler`;
    case 'guard':
      return `${handled.name}GuardHandler`;
    case 'command':
      return `${pairingNameOf(handled)}CommandHandler`;
    case 'subscription':
      return `${pairingNameOf(handled)}SubscriptionHandler`;
  }
}

/**
 * The name the readers file imports a Command's Message Version or a Subscription under, suffixed
 * by its kind so it never meets a Reader, a def or another kind's import: `chargeCardV1Command`.
 */
export function importAliasOf(handled: MessageHandled): string {
  switch (handled.kind) {
    case 'command':
      return `${pairingNameOf(handled)}Command`;
    case 'subscription':
      return `${pairingNameOf(handled)}Subscription`;
  }
}
