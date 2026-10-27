import type { Command, Endpoint, Guard, Subscription } from '@cf-loom/contract';
import { isCommand, isSubscription } from '@cf-loom/contract/internal';

/** A Command's Message Version or a Subscription: what a Message Handler is written for. */
export type MessageHandled = Command | Subscription;

/** An Endpoint, a Guard, a Command's Message Version or a Subscription: what a Handler is written for. */
export type Handled = Endpoint | Guard | MessageHandled;

/** Whether a value is a Command's Message Version or a Subscription, what a Message Handler is written for. */
export function isMessageHandled(value: unknown): value is MessageHandled {
  return isCommand(value) || isSubscription(value);
}
