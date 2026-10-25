import type { Group, GroupedField } from '../declarations/index.ts';
import {
  type Declarations,
  type Listed,
  type LocatedGroup,
  listedIn,
  listOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const groupedFields = ['endpoints', 'events', 'commands', 'subscriptions'] as const;

/** How the Groups rule names a declaration of one field: its kind, and the declaration itself. */
type Membership<Field extends GroupedField> = {
  readonly noun: string;
  readonly labelOf: (listed: Listed<Field>) => string;
};

const memberships: { readonly [Field in GroupedField]: Membership<Field> } = {
  endpoints: { noun: 'An Endpoint', labelOf: ({ declaration }) => textOf(declaration.name) },
  events: { noun: "An Event's Message Version", labelOf: keyOf },
  commands: { noun: "A Command's Message Version", labelOf: keyOf },
  subscriptions: { noun: 'A Subscription', labelOf: keyOf },
};

/** Every Group lists something, and every Endpoint, Message Version and Subscription is in exactly one Group. */
export function groupFailures({ groups }: Declarations): readonly DeclarationFailure[] {
  return [
    ...groups.filter(listsNothing).map(({ at }) => emptyGroupFailure(at)),
    ...membershipFailures(groups, 'endpoints'),
    ...membershipFailures(groups, 'events'),
    ...membershipFailures(groups, 'commands'),
    ...membershipFailures(groups, 'subscriptions'),
  ];
}

/** A list left out and an empty list both list nothing. */
function listsNothing({ group }: LocatedGroup): boolean {
  return groupedFields.every((field) => listOf(group[field]).length === 0);
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
  for (const listed of groups.flatMap((group) => listedIn(group, field))) {
    const first = firstGroupOf.get(listed.declaration);
    if (first !== undefined) {
      const message = `${noun} belongs to exactly one Group: ${labelOf(listed)} is also in ${textOf(first.name)}`;
      failures.push(failure(listed.at, 'group-membership', message));
    }
    firstGroupOf.set(listed.declaration, first ?? listed.group);
  }
  return failures;
}

function keyOf({ at }: Listed<GroupedField>): string {
  return textOf(at.at(-1));
}
