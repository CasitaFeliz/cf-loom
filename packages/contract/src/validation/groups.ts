import { type Group, type GroupedField, providerOf } from '../declarations/index.ts';
import {
  type Declarations,
  fieldListings,
  groupedFields,
  isEmptyField,
  type Listed,
  type LocatedGroup,
  listingsOf,
  providedListingsOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** How the Groups rule names a declaration of one field: its kind, and the declaration itself. */
type Membership<Field extends GroupedField> = {
  readonly noun: string;
  readonly labelOf: (listed: Listed<Field>) => string;
};

/** An Endpoint is named by its name; a Message Version and a Subscription by the key that locates it. */
const memberships: { readonly [Field in GroupedField]: Membership<Field> } = {
  endpoints: { noun: 'An Endpoint', labelOf: ({ declaration }) => textOf(declaration.name) },
  events: {
    noun: "An Event's Message Version",
    labelOf: ({ declaration }) => fieldListings.events.keyOf(declaration),
  },
  commands: {
    noun: "A Command's Message Version",
    labelOf: ({ declaration }) => fieldListings.commands.keyOf(declaration),
  },
  subscriptions: {
    noun: 'A Subscription',
    labelOf: ({ declaration }) => fieldListings.subscriptions.keyOf(declaration),
  },
};

/**
 * Every Group lists something, every Endpoint, Message Version and Subscription is in exactly one
 * Group, and what a Group lists is its Contract's own, never a Provider's.
 */
export function groupFailures({ groups }: Declarations): readonly DeclarationFailure[] {
  return [
    ...groups.filter(listsNothing).map(({ at }) => emptyGroupFailure(at)),
    ...groupedFields.flatMap((field) => membershipFailures(groups, field)),
    ...groupedFields.flatMap((field) => providedFailures(groups, field)),
  ];
}

/** A field lists nothing when it is left out or an empty list; anything else is the structure rule's. */
function listsNothing({ group }: LocatedGroup): boolean {
  return groupedFields.every((field) => isEmptyField(group[field]));
}

function emptyGroupFailure(at: LocatedGroup['at']): DeclarationFailure {
  const message = 'A Group lists at least one Endpoint, Event, Command or Subscription';
  return failure(at, 'empty-group', message);
}

/** Each listing of a declaration after its first, in a Group's order, names the Group that listed it first. */
function membershipFailures<Field extends GroupedField>(
  groups: readonly LocatedGroup[],
  field: Field,
): readonly DeclarationFailure[] {
  const { noun, labelOf } = memberships[field];
  const firstGroupOf = new Map<unknown, Group>();
  const failures: DeclarationFailure[] = [];
  for (const { at, group } of groups) {
    for (const listed of listingsOf({ at, group }, field)) {
      const first = firstGroupOf.get(listed.declaration);
      if (first !== undefined) {
        const message = `${noun} belongs to exactly one Group: ${labelOf(listed)} is also in ${textOf(first.name)}`;
        failures.push(failure(at, 'group-membership', message));
      }
      firstGroupOf.set(listed.declaration, first ?? group);
    }
  }
  return failures;
}

/** Each Provider's Element a Group lists, named with its Provider. */
function providedFailures<Field extends GroupedField>(
  groups: readonly LocatedGroup[],
  field: Field,
): readonly DeclarationFailure[] {
  const { labelOf } = memberships[field];
  return groups.flatMap((group) =>
    providedListingsOf(group, field).map((listed) => {
      const provider = providerOf(listed.declaration);
      const message = `A Group lists the Contract's own Elements: ${labelOf(listed)} is ${provider}'s`;
      return failure(group.at, 'provided-element', message);
    }),
  );
}
