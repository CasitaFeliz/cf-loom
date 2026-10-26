import type { Group } from '@cf-loom/contract';
import { declarationsListedBy, isGroup, isListable } from '@cf-loom/contract/internal';
import type { ExportedValue } from '../loading/index.ts';
import type { BuiltService } from '../project/index.ts';

/**
 * A line for every Group a file under `src/contract/` exports that the Root does not list, then
 * for every Endpoint, Event, Command's Message Version or Subscription it exports that no Group
 * lists, each at the first file that exports it.
 */
export function unreachedLinesOf(
  { validated }: BuiltService,
  exports: readonly ExportedValue[],
): readonly string[] {
  const rootGroups = validated.declarations.groups.map(({ group }) => group);
  const unlistedGroups = unlistedGroupsOf(rootGroups, exports);
  const reached = reachedOf([...rootGroups, ...unlistedGroups]);
  const groups = firstExportsOf(exports, (value) =>
    unlistedGroups.some((group) => group === value),
  );
  const declarations = firstExportsOf(exports, (value) => isListable(value) && !reached.has(value));
  return [...groups.map(unlistedGroupLineOf), ...declarations.map(unlistedDeclarationLineOf)];
}

/** The Groups that a file exports and the Root does not list. */
function unlistedGroupsOf(
  rootGroups: readonly Group[],
  exports: readonly ExportedValue[],
): readonly Group[] {
  return exports
    .map(({ value }) => value)
    .filter(isGroup)
    .filter((group) => !rootGroups.includes(group));
}

/** What needs no line: whatever a Group lists, the Root's or an unlisted one. A Provider's Element is no Group's to list. */
function reachedOf(groups: readonly Group[]): ReadonlySet<unknown> {
  return new Set<unknown>(groups.flatMap(declarationsListedBy));
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
  return `${path} exports ${name}, which the Root does not list: list it in groups or delete it`;
}

function unlistedDeclarationLineOf({ path, name }: ExportedValue): string {
  return `${path} exports ${name}, which no Group lists: list it in a Group or delete it`;
}
