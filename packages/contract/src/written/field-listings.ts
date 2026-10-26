import type {
  Command,
  Endpoint,
  Event,
  Group,
  GroupedField,
  Subscription,
} from '../declarations/index.ts';
import { isCommand, isEndpoint, isEvent, isSubscription } from '../declarations/index.ts';
import type { Place, Site } from '../walker/index.ts';
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
 * A declaration as a Group lists it, its Group, and where it sits: an Endpoint and a Message
 * Version by identity, a Subscription by name, else at the Group's list, by its position.
 */
export type Listed<Field extends GroupedField> = {
  readonly at: Place;
  readonly declaration: GroupedDeclarations[Field];
  readonly group: Group;
};

/**
 * What belongs in a field of a Group, as the structure rule names it, the key that identifies it
 * there and the site it sits at; none when it has no name to give one.
 */
export type FieldListing<Field extends GroupedField> = {
  readonly noun: string;
  readonly fits: (item: unknown) => item is GroupedDeclarations[Field];
  readonly keyOf: (declaration: GroupedDeclarations[Field]) => string;
  readonly siteOf: (declaration: GroupedDeclarations[Field]) => Site | undefined;
};

/** Each field of a Group: the one place that says what it holds and how each item is located. */
export const fieldListings: { readonly [Field in GroupedField]: FieldListing<Field> } = {
  endpoints: {
    noun: 'an Endpoint',
    fits: isEndpoint,
    keyOf: (endpoint) => identityOf(endpoint.method, endpoint.path),
    siteOf: (endpoint) =>
      typeof endpoint.name === 'string'
        ? {
            kind: 'endpoint',
            identity: identityOf(endpoint.method, endpoint.path),
            name: endpoint.name,
          }
        : undefined,
  },
  events: {
    noun: 'an Event',
    fits: isEvent,
    keyOf: (event) => messageIdentityOf(event.name, event.version),
    siteOf: (event) => ({ kind: 'event', identity: messageIdentityOf(event.name, event.version) }),
  },
  commands: {
    noun: 'a Command',
    fits: isCommand,
    keyOf: (command) => messageIdentityOf(command.name, command.version),
    siteOf: (command) => ({
      kind: 'command',
      identity: messageIdentityOf(command.name, command.version),
    }),
  },
  subscriptions: {
    noun: 'a Subscription',
    fits: isSubscription,
    keyOf: (subscription) => textOf(subscription.name),
    siteOf: (subscription) =>
      typeof subscription.name === 'string'
        ? { kind: 'subscription', name: subscription.name }
        : undefined,
  },
};

/** The fields a Group lists declarations in, in the order the rules read them. */
export const groupedFields = Object.keys(fieldListings) as readonly GroupedField[];
