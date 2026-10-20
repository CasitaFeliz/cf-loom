import { byCodePoint, codeNameOf } from '@cf-loom/contract/internal';
import { camelCaseOf } from '../source-text/index.ts';
import type { Handled, MessageHandled } from './handled.ts';

/**
 * The name a Command's Message Version or a Subscription is paired under, which its stub imports:
 * `chargeCardV1`, `notifyOnSettled`.
 */
export function pairingNameOf(handled: MessageHandled): string {
  switch (handled.kind) {
    case 'command':
      return codeNameOf(handled);
    case 'subscription':
      return camelCaseOf(handled.name);
  }
}

/** Orders Commands' Message Versions by name in code, as the Handler map and the readers list them. */
export function byCommandName(
  left: { readonly name: string; readonly version: number },
  right: { readonly name: string; readonly version: number },
): number {
  return byCodePoint(codeNameOf(left), codeNameOf(right));
}

/** The name of an own Message Version's Reader schema: `orderCreatedV2Reader`. */
export function readerNameOf(message: { readonly name: string; readonly version: number }): string {
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

/** A name `readers.generated.ts` declares or imports, and what it names: `commands.ChargeCard@1`. */
export type NamedInCode = { readonly code: string; readonly names: string };

/**
 * The line saying which Subscription is paired under a name the file already takes, the first in
 * the order given; only a Subscription's name in code is free enough to meet another.
 */
export function collidingSubscriptionLineOf(
  taken: readonly NamedInCode[],
  subscriptions: readonly string[],
): string | undefined {
  const namesByCode = new Map(taken.map(({ code, names }) => [code, names]));
  for (const name of subscriptions) {
    const code = pairingNameOf({ kind: 'subscription', name });
    const earlier = namesByCode.get(code);
    if (earlier !== undefined) {
      return `subscriptions.${name} is ${code} in code, as ${earlier} is: rename the Subscription`;
    }
    namesByCode.set(code, `subscriptions.${name}`);
  }
  return undefined;
}
