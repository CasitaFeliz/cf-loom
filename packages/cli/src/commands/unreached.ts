import type { Dependency, Group } from '@cf-loom/contract';
import {
  declarationsListedBy,
  isCommand,
  isEndpoint,
  isEvent,
  isGroup,
  isSubscription,
} from '@cf-loom/contract/internal';
import type { ExportedValue } from '../loading/index.ts';
import type { BuiltService } from '../project/index.ts';

type Declarations = BuiltService['validated']['declarations'];

/**
 * A line for every Endpoint, Event, Command's Message Version or Subscription that a file under
 * `src/contract/` exports and no Group lists, and for every Group it exports that the root does
 * not list, whose own declarations get none: each once, at the first file that exports it, since
 * the Contract would leave it out without a word.
 */
export function unreachedLinesOf(
  { validated }: BuiltService,
  exports: readonly ExportedValue[],
): readonly string[] {
  const unlistedGroups = unlistedGroupsOf(validated.declarations, exports);
  const reached = reachedOf(validated.declarations, unlistedGroups);
  const unreached = exports.filter(({ value }) =>
    isGroup(value) ? unlistedGroups.includes(value) : isListable(value) && !reached.has(value),
  );
  const firsts = unreached.filter(
    ({ value }, index) => unreached.findIndex((other) => other.value === value) === index,
  );
  return firsts.map(lineOf);
}

/** The Groups that a file exports and the root does not list. */
function unlistedGroupsOf(
  { groups }: Declarations,
  exports: readonly ExportedValue[],
): readonly Group[] {
  const listed = groups.map(({ group }) => group);
  return exports
    .map(({ value }) => value)
    .filter(isGroup)
    .filter((group) => !listed.includes(group));
}

/** What needs no line: what a Group of the root lists, what a Provider owns, and what an unlisted Group lists. */
function reachedOf(
  { endpoints, events, commands, subscriptions, dependencies }: Declarations,
  unlistedGroups: readonly Group[],
): ReadonlySet<unknown> {
  return new Set<unknown>([
    ...endpoints.map(({ endpoint }) => endpoint),
    ...events.map(({ event }) => event),
    ...commands.map(({ command }) => command),
    ...subscriptions.map(({ subscription }) => subscription),
    ...dependencies.flatMap(({ dependency }) => providedBy(dependency)),
    ...unlistedGroups.flatMap(declarationsListedBy),
  ]);
}

/** The Endpoints and Events a Dependency's Provider exports, which it owns and no Group of this Contract lists. */
function providedBy({ provider }: Dependency): readonly unknown[] {
  return [...Object.values(provider.endpoints), ...Object.values(provider.events)];
}

function isListable(value: unknown): boolean {
  return isEndpoint(value) || isEvent(value) || isCommand(value) || isSubscription(value);
}

function lineOf({ path, name, value }: ExportedValue): string {
  const unlisted = isGroup(value)
    ? 'the root does not list: list it in groups'
    : 'no Group lists: list it in a Group';
  return `${path} exports ${name}, which ${unlisted} or delete it`;
}
