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
 * What belongs in a field of a Group, as the structure rule names it, and the site it sits at;
 * none when its name, method, path or version is none that can name one.
 */
export type FieldListing<Field extends GroupedField> = {
  readonly noun: string;
  readonly fits: (item: unknown) => item is GroupedDeclarations[Field];
  readonly siteOf: (declaration: GroupedDeclarations[Field]) => Site | undefined;
};

/** Each field of a Group: the one place that says what it holds and how each item is located. */
export const fieldListings: { readonly [Field in GroupedField]: FieldListing<Field> } = {
  endpoints: {
    noun: 'an Endpoint',
    fits: isEndpoint,
    siteOf: ({ name, method, path }) =>
      isText(name) && isText(method) && isText(path)
        ? { kind: 'endpoint', identity: identityOf(method, path), name }
        : undefined,
  },
  events: {
    noun: 'an Event',
    fits: isEvent,
    siteOf: ({ name, version }) =>
      isText(name) && typeof version === 'number'
        ? { kind: 'event', identity: messageIdentityOf(name, version) }
        : undefined,
  },
  commands: {
    noun: 'a Command',
    fits: isCommand,
    siteOf: ({ name, version }) =>
      isText(name) && typeof version === 'number'
        ? { kind: 'command', identity: messageIdentityOf(name, version) }
        : undefined,
  },
  subscriptions: {
    noun: 'a Subscription',
    fits: isSubscription,
    siteOf: ({ name }) => (isText(name) ? { kind: 'subscription', name } : undefined),
  },
};

/** Whether a written value is a string, which a name, a method or a path must be to name a site. */
function isText(value: unknown): value is string {
  return typeof value === 'string';
}

/** The fields a Group lists declarations in, in the order the rules read them. */
export const groupedFields = Object.keys(fieldListings) as readonly GroupedField[];
