import {
  declarationsListedBy,
  isGroup,
  isListable,
  providerExportsOf,
} from '@cf-loom/contract/internal';
import type { ExportedValue } from '../loading/index.ts';
import type { BuiltService } from '../project/index.ts';

type ValidatedDeclarations = BuiltService['validated']['declarations'];

/**
 * A line for every Group a file under `src/contract/` exports that the root does not list, then
 * for every Endpoint, Event, Command's Message Version or Subscription it exports that no Group
 * lists, each at the first file that exports it.
 */
export function unreachedLinesOf(
  { validated }: BuiltService,
  exports: readonly ExportedValue[],
): readonly string[] {
  const unlistedGroups = unlistedGroupsOf(validated.declarations, exports);
  const reached = reachedOf(validated.declarations, unlistedGroups);
  const groups = firstExportsOf(exports, (value) => unlistedGroups.includes(value));
  const declarations = firstExportsOf(exports, (value) => isListable(value) && !reached.has(value));
  return [...groups.map(unlistedGroupLineOf), ...declarations.map(unlistedDeclarationLineOf)];
}

/** The Groups that a file exports and the root does not list. */
function unlistedGroupsOf(
  { groups }: ValidatedDeclarations,
  exports: readonly ExportedValue[],
): readonly unknown[] {
  const listed: readonly unknown[] = groups.map(({ group }) => group);
  return exports
    .map(({ value }) => value)
    .filter((value) => isGroup(value) && !listed.includes(value));
}

/** What needs no line: whatever a Group lists, the root's or an unlisted one, and what a Provider exports. */
function reachedOf(
  { groups, dependencies }: ValidatedDeclarations,
  unlistedGroups: readonly unknown[],
): ReadonlySet<unknown> {
  const allGroups = [...groups.map(({ group }) => group), ...unlistedGroups.filter(isGroup)];
  return new Set<unknown>([
    ...allGroups.flatMap(declarationsListedBy),
    ...dependencies.flatMap(({ dependency }) =>
      Object.values(providerExportsOf(dependency)).flat(),
    ),
  ]);
}

/** The first export of each exported value that `isUnreached` holds for. */
function firstExportsOf(
  exports: readonly ExportedValue[],
  isUnreached: (value: unknown) => boolean,
): readonly ExportedValue[] {
  const unreached = exports.filter(({ value }) => isUnreached(value));
  return unreached.filter(
    ({ value }, index) => unreached.findIndex((other) => other.value === value) === index,
  );
}

function unlistedGroupLineOf({ path, name }: ExportedValue): string {
  return `${path} exports ${name}, which the root does not list: list it in groups or delete it`;
}

function unlistedDeclarationLineOf({ path, name }: ExportedValue): string {
  return `${path} exports ${name}, which no Group lists: list it in a Group or delete it`;
}
