import type { Command, Endpoint, Guard, Subscription } from '@cf-loom/contract';
import { isCommand, isSubscription } from '@cf-loom/contract/internal';

/** A Command's Message Version or a Subscription: the Elements a Message Handler is written for. */
export type MessageElement = Command | Subscription;

/** Any Element a Handler is written for. */
export type HandledElement = Endpoint | Guard | MessageElement;

/** Whether a value is a Command's Message Version or a Subscription, the Elements a Message Handler is written for. */
export function isMessageElement(value: unknown): value is MessageElement {
  return isCommand(value) || isSubscription(value);
}
