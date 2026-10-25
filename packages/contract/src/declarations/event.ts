import type * as core from 'zod/v4/core';
import type { EventVisibility, Lifecycle } from './element.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule, MessageBodyRule, VersionRule } from './rules.ts';

/** What an author writes to declare one Message Version of an Event; a `lifecycle` left out is Active. */
export type EventDeclaration = {
  readonly name: string;
  readonly version: number;
  readonly visibility: EventVisibility;
  readonly description: string;
  readonly body: core.$ZodType;
  readonly lifecycle?: Lifecycle;
};

/** A declared Event's Message Version, kept as written so its publisher, its Subscribers and the walker read one schema. */
export type Event<Declaration extends EventDeclaration = EventDeclaration> =
  Readonly<Declaration> & { readonly kind: 'event' };

/** Declares one Message Version of an Event, refusing what TypeScript can state exactly. */
export function defineEvent<const Declaration extends EventDeclaration>(
  declaration: Declaration &
    VersionRule<Declaration> &
    MessageBodyRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, EventDeclaration>>,
): Event<Declaration> {
  return freezeDeclaration('event', declaration);
}
