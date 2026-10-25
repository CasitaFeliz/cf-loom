import { isEvent, isLive, reaches } from '../declarations/index.ts';
import {
  type Declarations,
  eventServiceOf,
  isWithoutValue,
  type LocatedSubscription,
  messageIdentityOf,
  type Root,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { repeated } from './names.ts';

/** Each Subscription receives an Event that still works, the Service's own or one a listed Dependency's Provider exports, under a name of its own. */
export function subscriptionFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, subscriptions } = declarations;
  return [
    ...subscriptions.flatMap((located) => eventFailures(located, root)),
    ...nameFailures(subscriptions),
  ];
}

/** A missing Event is the required-field rule's; anything else is an Event the Service receives. */
function eventFailures(
  { at, subscription }: LocatedSubscription,
  root: Root,
): readonly DeclarationFailure[] {
  const event: unknown = subscription.event;
  const eventAt = [...at, 'event'];
  if (isWithoutValue(event)) {
    return [];
  }
  if (!isEvent(event)) {
    return [failure(eventAt, 'not-a-declaration', 'event is not an Event')];
  }
  const identity = messageIdentityOf(event.name, event.version);
  const service = eventServiceOf(root, event);
  if (service === undefined) {
    const message = `A Subscription's Event is the Service's own or one a listed Dependency's Provider exports: ${identity}`;
    return [failure(eventAt, 'subscription-event', message)];
  }
  if (service !== root.name && !reaches('service', event.visibility)) {
    const message = `A Subscription receives another Service's Event only when it is Public or Internal: ${identity} is ${event.visibility}`;
    return [failure(eventAt, 'subscription-event', message)];
  }
  if (!isLive(event)) {
    const message = `A Subscription's Event is not Retired: ${identity}`;
    return [failure(eventAt, 'retired-event-subscribed', message)];
  }
  return [];
}

function nameFailures(
  subscriptions: readonly LocatedSubscription[],
): readonly DeclarationFailure[] {
  const nameOf = (located: LocatedSubscription) => textOf(located.subscription.name);
  return repeated(subscriptions, nameOf).map((located) =>
    failure(
      [...located.at, 'name'],
      'duplicate-subscription-name',
      `A Subscription name is unique in the Service: ${nameOf(located)}`,
    ),
  );
}
