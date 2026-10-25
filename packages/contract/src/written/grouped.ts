import type {
  Command,
  Contract,
  Endpoint,
  Event,
  Group,
  GroupedField,
  Subscription,
} from '../declarations/index.ts';
import { isCommand, isEndpoint, isEvent, isGroup, isSubscription } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { identityOf, messageIdentityOf } from './identity.ts';
import type {
  LocatedCommand,
  LocatedEndpoint,
  LocatedEvent,
  LocatedGroup,
  LocatedSubscription,
  Root,
} from './located.ts';
import { listOf, textOf } from './written.ts';

/** The declaration each field of a Group lists. */
type GroupedDeclarations = {
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

/** What belongs in a field of a Group, and the key that locates it there. */
type Listing<Field extends GroupedField> = {
  readonly fits: (item: unknown) => item is GroupedDeclarations[Field];
  readonly keyOf: (declaration: GroupedDeclarations[Field]) => string;
};

const listings: { readonly [Field in GroupedField]: Listing<Field> } = {
  endpoints: { fits: isEndpoint, keyOf: (endpoint) => identityOf(endpoint.method, endpoint.path) },
  events: { fits: isEvent, keyOf: (event) => messageIdentityOf(event.name, event.version) },
  commands: {
    fits: isCommand,
    keyOf: (command) => messageIdentityOf(command.name, command.version),
  },
  subscriptions: { fits: isSubscription, keyOf: (subscription) => textOf(subscription.name) },
};

/** What a root's Groups list, each declaration once, where first met, located under its Group. */
export type Grouped = {
  readonly endpoints: readonly LocatedEndpoint[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly LocatedSubscription[];
};

/** A root's Groups, each where it sits by name; only a Contract has them. */
export function groupsOf(root: Root): readonly LocatedGroup[] {
  if (root.kind !== 'contract') {
    return [];
  }
  return listOf(root.groups)
    .filter(isGroup)
    .map((group) => ({ at: ['groups', textOf(group.name)], group }));
}

/** Gathers what a root's Groups list; a declaration listed twice is the Groups rule's to report. */
export function groupedOf(groups: readonly LocatedGroup[]): Grouped {
  return {
    endpoints: distinctListed(groups, 'endpoints').map(({ at, declaration, group }) => ({
      at,
      endpoint: declaration,
      group,
    })),
    events: distinctListed(groups, 'events').map(({ at, declaration, group }) => ({
      at,
      event: declaration,
      group,
    })),
    commands: distinctListed(groups, 'commands').map(({ at, declaration, group }) => ({
      at,
      command: declaration,
      group,
    })),
    subscriptions: distinctListed(groups, 'subscriptions').map(({ at, declaration, group }) => ({
      at,
      subscription: declaration,
      group,
    })),
  };
}

/** Every declaration a Group lists in one field, in its order, repeats included. */
export function listedIn<Field extends GroupedField>(
  { at, group }: LocatedGroup,
  field: Field,
): readonly Listed<Field>[] {
  const { fits, keyOf } = listings[field];
  return listOf(group[field])
    .filter(fits)
    .map((declaration) => ({ at: [...at, field, keyOf(declaration)], declaration, group }));
}

/** Every Endpoint a Contract lists through its Groups, each once, in the root's order. */
export function endpointsOf(contract: Contract): readonly Endpoint[] {
  return declarationsListed(contract, 'endpoints');
}

/** Every Event's Message Version a Contract lists through its Groups, each once, in the root's order. */
export function eventsOf(contract: Contract): readonly Event[] {
  return declarationsListed(contract, 'events');
}

/** Every Command's Message Version a Contract lists through its Groups, each once, in the root's order. */
export function commandsOf(contract: Contract): readonly Command[] {
  return declarationsListed(contract, 'commands');
}

/** Every Subscription a Contract lists through its Groups, each once, in the root's order. */
export function subscriptionsOf(contract: Contract): readonly Subscription[] {
  return declarationsListed(contract, 'subscriptions');
}

function declarationsListed<Field extends GroupedField>(
  contract: Contract,
  field: Field,
): readonly GroupedDeclarations[Field][] {
  return distinctListed(groupsOf(contract), field).map(({ declaration }) => declaration);
}

/** A declaration listed twice is one declaration, where first met. */
function distinctListed<Field extends GroupedField>(
  groups: readonly LocatedGroup[],
  field: Field,
): readonly Listed<Field>[] {
  const seen = new Set<unknown>();
  const distinct: Listed<Field>[] = [];
  for (const listed of groups.flatMap((group) => listedIn(group, field))) {
    if (!seen.has(listed.declaration)) {
      seen.add(listed.declaration);
      distinct.push(listed);
    }
  }
  return distinct;
}
