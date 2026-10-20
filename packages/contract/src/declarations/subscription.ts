import type { Lifecycle } from './element.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** What an author writes to declare a Subscription: the name of its durable consumer and an Event that still works. */
type SubscriptionDeclaration = {
  readonly name: string;
  readonly event: Event & { readonly lifecycle?: Exclude<Lifecycle, 'retired'> };
};

/** A declared Subscription, kept with its Event itself, the Event its Handler's Reader reads. */
export type Subscription<Declaration extends SubscriptionDeclaration = SubscriptionDeclaration> =
  Readonly<Declaration> & { readonly kind: 'subscription' };

/** Declares that a Service receives an Event, its own or one listed in a Dependency. */
export function defineSubscription<const Declaration extends SubscriptionDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, SubscriptionDeclaration>>,
): Subscription<Declaration> {
  return freezeDeclaration('subscription', declaration);
}
