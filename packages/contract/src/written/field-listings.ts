import type {
  Command,
  Endpoint,
  Event,
  Group,
  GroupedField,
  Subscription,
} from '../declarations/index.ts';
import { isCommand, isEndpoint, isEvent, isSubscription } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { identityOf, messageIdentityOf } from './identity.ts';
import { textOf } from './written.ts';

/** The declaration each field of a Group lists. */
export type GroupedDeclarations = {
  readonly endpoints: Endpoint;
  readonly events: Event;
  readonly commands: Command;
  readonly subscriptions: Subscription;
};

/**
 * A declaration as a Group lists it, its Group, and where it sits under that Group: an Endpoint
 * and a Message Version by identity, a Subscription by name.
 */
export type Listed<Field extends GroupedField> = {
  readonly at: Path;
  readonly declaration: GroupedDeclarations[Field];
  readonly group: Group;
};

/** What belongs in a field of a Group, as the structure rule names it, and the key that locates it there. */
export type FieldListing<Field extends GroupedField> = {
  readonly noun: string;
  readonly fits: (item: unknown) => item is GroupedDeclarations[Field];
  readonly keyOf: (declaration: GroupedDeclarations[Field]) => string;
};

/** Each field of a Group: the one place that says what it holds and how each item is located. */
export const fieldListings: { readonly [Field in GroupedField]: FieldListing<Field> } = {
  endpoints: {
    noun: 'an Endpoint',
    fits: isEndpoint,
    keyOf: (endpoint) => identityOf(endpoint.method, endpoint.path),
  },
  events: {
    noun: 'an Event',
    fits: isEvent,
    keyOf: (event) => messageIdentityOf(event.name, event.version),
  },
  commands: {
    noun: 'a Command',
    fits: isCommand,
    keyOf: (command) => messageIdentityOf(command.name, command.version),
  },
  subscriptions: {
    noun: 'a Subscription',
    fits: isSubscription,
    keyOf: (subscription) => textOf(subscription.name),
  },
};

/** The fields a Group lists declarations in, in the order the rules read them. */
export const groupedFields = Object.keys(fieldListings) as readonly GroupedField[];
