import type {
  Command,
  Contract,
  Endpoint,
  Event,
  Group,
  GroupedField,
  Subscription,
} from '../declarations/index.ts';
import { isGroup, providerOf } from '../declarations/index.ts';
import {
  fieldListings,
  type GroupedDeclarations,
  groupedFields,
  type Listed,
} from './field-listings.ts';
import type {
  LocatedCommand,
  LocatedEndpoint,
  LocatedEvent,
  LocatedGroup,
  LocatedSubscription,
  Root,
} from './located.ts';
import { listOf, textOf } from './written.ts';

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

/**
 * Whether a value is an Endpoint, Event, Command or Subscription of the Contract that declares it,
 * which a Group lists; a Provider's Element is not.
 */
export function isListable(value: unknown): value is GroupedDeclarations[GroupedField] {
  return isOwn(value) && groupedFields.some((field) => fieldListings[field].fits(value));
}

/** Every declaration a Group lists in one field that is the Contract's own, in its order, repeats included. */
export function listingsOf<Field extends GroupedField>(
  located: LocatedGroup,
  field: Field,
): readonly Listed<Field>[] {
  return locatedIn(located, field, fittingIn(located.group, field).filter(isOwn));
}

/** Every Provider's Element a Group lists in one field, in its order, located as `listingsOf` locates them. */
export function providedListingsOf<Field extends GroupedField>(
  located: LocatedGroup,
  field: Field,
): readonly Listed<Field>[] {
  return locatedIn(located, field, fittingIn(located.group, field).filter(isProvided));
}

/** Every own declaration a Group's lists hold, in field order; what fits no field is left out. */
export function declarationsListedBy(group: Group): readonly unknown[] {
  return groupedFields.flatMap((field) => fittingIn(group, field).filter(isOwn));
}

function isOwn(value: unknown): boolean {
  return providerOf(value) === undefined;
}

function isProvided(value: unknown): boolean {
  return providerOf(value) !== undefined;
}

function fittingIn<Field extends GroupedField>(
  group: Group,
  field: Field,
): readonly GroupedDeclarations[Field][] {
  return listOf(group[field]).filter(fieldListings[field].fits);
}

function locatedIn<Field extends GroupedField>(
  { at, group }: LocatedGroup,
  field: Field,
  declarations: readonly GroupedDeclarations[Field][],
): readonly Listed<Field>[] {
  const { keyOf } = fieldListings[field];
  return declarations.map((declaration) => ({
    at: [...at, field, keyOf(declaration)],
    declaration,
    group,
  }));
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
  for (const listed of groups.flatMap((group) => listingsOf(group, field))) {
    if (!seen.has(listed.declaration)) {
      seen.add(listed.declaration);
      distinct.push(listed);
    }
  }
  return distinct;
}
