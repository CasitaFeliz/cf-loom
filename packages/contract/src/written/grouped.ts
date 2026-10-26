import type {
  Command,
  Endpoint,
  Event,
  Group,
  GroupedField,
  Root,
  ServiceContract,
  Subscription,
} from '../declarations/index.ts';
import { isGroup, providerOf } from '../declarations/index.ts';
import { fieldStep, indexStep, inside, type Place, placeOf, type Site } from '../walker/index.ts';
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
} from './located.ts';
import { listOf } from './written.ts';

/** What a Root's Groups list, each declaration once, where first met, located under its Group. */
export type Grouped = {
  readonly endpoints: readonly LocatedEndpoint[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly LocatedSubscription[];
};

/** A Root's Groups, each where it sits by name, else at the Root's list of Groups; only a Service's Contract has them. */
export function groupsOf(root: Root): readonly LocatedGroup[] {
  if (root.kind !== 'service') {
    return [];
  }
  const holder = placeOf({ kind: 'root' }, root);
  const groups = listOf<unknown>(root.groups).map((group, index) => ({ group, index }));
  return groups.filter(isListedGroup).map(({ group, index }) => ({
    at: placedIn({ holder, field: 'groups', index }, group, groupSiteOf(group)),
    group,
  }));
}

function groupSiteOf(group: Group): Site | undefined {
  return typeof group.name === 'string' ? { kind: 'group', name: group.name } : undefined;
}

function isListedGroup(listed: { readonly group: unknown }): listed is {
  readonly group: Group;
  readonly index: number;
} {
  return isGroup(listed.group);
}

/**
 * Where a declaration sits: at its own site, else at the place that holds it, in the field of its
 * list and at its position there, so a declaration with no name is still found.
 */
export function placedIn(listing: Listing, declaration: unknown, site: Site | undefined): Place {
  if (site !== undefined) {
    return placeOf(site, declaration);
  }
  const { holder, field, index } = listing;
  return { ...inside(holder, fieldStep(field), indexStep(index)), declaration };
}

/** Where a declaration is written: the place whose field lists it, that field, and the position there. */
export type Listing = { readonly holder: Place; readonly field: string; readonly index: number };

/** Gathers what a Root's Groups list; a declaration listed twice is the Groups rule's to report. */
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
  return locatedIn(located, field, fittingIn(located.group, field).filter(isOwnListing));
}

/** Every Provider's Element a Group lists in one field, in its order, located as `listingsOf` locates them. */
export function providedListingsOf<Field extends GroupedField>(
  located: LocatedGroup,
  field: Field,
): readonly Listed<Field>[] {
  return locatedIn(located, field, fittingIn(located.group, field).filter(isProvidedListing));
}

/** Every own declaration a Group's lists hold, in field order; what fits no field is left out. */
export function declarationsListedBy(group: Group): readonly unknown[] {
  return groupedFields.flatMap((field) =>
    fittingIn(group, field)
      .filter(isOwnListing)
      .map(({ declaration }) => declaration),
  );
}

function isOwn(value: unknown): boolean {
  return providerOf(value) === undefined;
}

function isProvided(value: unknown): boolean {
  return providerOf(value) !== undefined;
}

function isOwnListing({ declaration }: { readonly declaration: unknown }): boolean {
  return isOwn(declaration);
}

function isProvidedListing({ declaration }: { readonly declaration: unknown }): boolean {
  return isProvided(declaration);
}

/** A declaration of a Group's list and its position in the list as written. */
type Fitting<Field extends GroupedField> = {
  readonly declaration: GroupedDeclarations[Field];
  readonly index: number;
};

function fittingIn<Field extends GroupedField>(
  group: Group,
  field: Field,
): readonly Fitting<Field>[] {
  const { fits } = fieldListings[field];
  const written = listOf<unknown>(group[field]).map((declaration, index) => ({
    declaration,
    index,
  }));
  return written.filter((listed): listed is Fitting<Field> => fits(listed.declaration));
}

function locatedIn<Field extends GroupedField>(
  { at, group }: LocatedGroup,
  field: Field,
  fitting: readonly Fitting<Field>[],
): readonly Listed<Field>[] {
  const { siteOf } = fieldListings[field];
  return fitting.map(({ declaration, index }) => ({
    at: placedIn({ holder: at, field, index }, declaration, siteOf(declaration)),
    declaration,
    group,
  }));
}

/** Every Endpoint a Contract lists through its Groups, each once, in the Root's order. */
export function endpointsOf(contract: ServiceContract): readonly Endpoint[] {
  return declarationsListed(contract, 'endpoints');
}

/** Every Event's Message Version a Contract lists through its Groups, each once, in the Root's order. */
export function eventsOf(contract: ServiceContract): readonly Event[] {
  return declarationsListed(contract, 'events');
}

/** Every Command's Message Version a Contract lists through its Groups, each once, in the Root's order. */
export function commandsOf(contract: ServiceContract): readonly Command[] {
  return declarationsListed(contract, 'commands');
}

/** Every Subscription a Contract lists through its Groups, each once, in the Root's order. */
export function subscriptionsOf(contract: ServiceContract): readonly Subscription[] {
  return declarationsListed(contract, 'subscriptions');
}

function declarationsListed<Field extends GroupedField>(
  contract: ServiceContract,
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
