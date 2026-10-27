import type { Command } from './command.ts';
import type { Endpoint } from './endpoint.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Own } from './provided.ts';
import type { DeclaredFieldsRule, ListsSomethingRule } from './rules.ts';
import type { Subscription } from './subscription.ts';

/** A list a Group holds: never empty, since a list left out already means none, and of its Contract's own Elements. */
type Listing<Item> = readonly [Own<Item>, ...Own<Item>[]];

/** What an author writes to declare a Group: a name, what it is for, and what it lists, of at least one kind. */
type GroupDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly endpoints?: Listing<Endpoint>;
  readonly events?: Listing<Event>;
  readonly commands?: Listing<Command>;
  readonly subscriptions?: Listing<Subscription>;
};

/** A declared Group, which organizes Endpoints, Events, Commands and Subscriptions for code and documentation and adds nothing. */
export type Group<Declaration extends GroupDeclaration = GroupDeclaration> =
  Readonly<Declaration> & { readonly kind: 'group' };

/** Declares a named set of Endpoints, Events, Commands and Subscriptions; each of them belongs to exactly one Group. */
export function defineGroup<const Declaration extends GroupDeclaration>(
  declaration: Declaration &
    NoInfer<ListsSomethingRule<Declaration> & DeclaredFieldsRule<Declaration, GroupDeclaration>>,
): Group<Declaration> {
  return freezeDeclaration('group', declaration);
}
