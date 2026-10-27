import type { Command } from './command.ts';
import type { Lifecycle } from './element.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule, ReservedNameRule } from './rules.ts';

/** What an author writes to declare a Subscription: its name, what it is for, and an Event that still works. */
type SubscriptionDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly event: Event & { readonly lifecycle?: Exclude<Lifecycle, 'retired'> };
};

/** What `event` may hold as written, so a Command reaches the rule that says why it cannot. */
type WrittenSubscription = Omit<SubscriptionDeclaration, 'event'> & {
  readonly event: SubscriptionDeclaration['event'] | Command;
};

/** Why a Subscription never receives a Command, as the types and `generate` both say it. */
export const commandSubscribedRefusal =
  "A Subscription receives an Event; a Command's Message Version has its own Message Handler";

/** What a Subscription must also satisfy: it receives an Event, never a Command. */
type SubscribedEventRule<Declaration extends WrittenSubscription> =
  Declaration['event'] extends Command
    ? { readonly event: typeof commandSubscribedRefusal }
    : unknown;

/** A declared Subscription, kept with its Event itself, the Event its Handler's Reader reads. */
export type Subscription<Declaration extends SubscriptionDeclaration = SubscriptionDeclaration> =
  Readonly<Declaration> & { readonly kind: 'subscription' };

/** Declares that a Service receives an Event, its own or one another Service's Contract Package exports. */
export function defineSubscription<const Declaration extends WrittenSubscription>(
  declaration: Declaration &
    SubscribedEventRule<Declaration> &
    NoInfer<
      ReservedNameRule<Declaration> & DeclaredFieldsRule<Declaration, SubscriptionDeclaration>
    >,
): Subscription<Extract<Declaration, SubscriptionDeclaration>> {
  return freezeDeclaration(
    'subscription',
    declaration as Extract<Declaration, SubscriptionDeclaration>,
  );
}
