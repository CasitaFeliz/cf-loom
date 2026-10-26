import type { Definitions, Root } from '../declarations/index.ts';
import { isDefinitions, isDependency, isServiceContract } from '../declarations/index.ts';
import { inFields, type Place, placeOf } from '../walker/index.ts';
import { groupedOf, groupsOf, placedIn } from './grouped.ts';
import type {
  LocatedCode,
  LocatedCommand,
  LocatedDependency,
  LocatedEndpoint,
  LocatedEvent,
  LocatedGroup,
  LocatedGuard,
  LocatedRejection,
  LocatedStandardRejection,
  LocatedSubscription,
  NamedDefinitions,
} from './located.ts';
import { type Members, membersOf } from './members.ts';
import { codesOf, guardsOf, rejectionsOf } from './references.ts';
import { entriesOf, isPlainObject, listOf } from './written.ts';

/**
 * Every declaration of a Root, each once, with where it sits, so each rule reads one list; what
 * sits where a declaration belongs and is none is left out here and reported by the structure rules.
 */
export type Declarations = {
  readonly root: Root;
  /** What a Definitions Package's Root file exports that it shares; none for another Root. */
  readonly ownMembers: Members | undefined;
  /** The Definitions Package a Contract names as `standardRejections`, at that field; none for another Root. */
  readonly standardRejectionsSource: NamedDefinitions | undefined;
  readonly groups: readonly LocatedGroup[];
  readonly endpoints: readonly LocatedEndpoint[];
  /** Every Guard the Root reaches, each once. */
  readonly guards: readonly LocatedGuard[];
  /** Every Rejection the Root reaches, each once, in the Root's order. */
  readonly rejections: readonly LocatedRejection[];
  /** Every code the Root reaches, each once, with every declaration of it. */
  readonly codes: readonly LocatedCode[];
  /** The Standard Rejections the Root's declaring package declares. */
  readonly standardRejections: readonly LocatedStandardRejection[];
  readonly dependencies: readonly LocatedDependency[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly LocatedSubscription[];
};

/**
 * Gathers what a Root reaches, Guards and Rejections included, each where it was first met: what
 * its Endpoints reach, and for a Definitions Package the members its file exports, by `rootExports`.
 */
export function declarationsOf(
  root: Root,
  rootExports: Readonly<Record<string, unknown>>,
): Declarations {
  const groups = groupsOf(root);
  const { endpoints, events, commands, subscriptions } = groupedOf(groups);
  const ownMembers = root.kind === 'definitions' ? membersOf(rootExports) : undefined;
  const standardRejectionsSource = namedSourceOf(root);
  const sources = { ownMembers, endpoints };
  const guards = guardsOf(sources);
  const rejections = rejectionsOf(sources, guards);
  const declarer = standardRejectionsDeclarerOf({ root, standardRejectionsSource });
  return {
    root,
    ownMembers,
    standardRejectionsSource,
    groups,
    endpoints,
    guards,
    rejections,
    codes: codesOf(rejections),
    standardRejections: declarer === undefined ? [] : standardRejectionsOf(declarer),
    dependencies: dependenciesOf(root),
    events,
    commands,
    subscriptions,
  };
}

/**
 * The Definitions Package whose `standardRejections` a Root's Standard Rejections come from: the
 * one a Contract names, or a Definitions Package itself.
 */
export function standardRejectionsDeclarerOf({
  root,
  standardRejectionsSource,
}: Pick<Declarations, 'root' | 'standardRejectionsSource'>): NamedDefinitions | undefined {
  return root.kind === 'definitions'
    ? { at: placeOf({ kind: 'root' }, root), definitions: root }
    : standardRejectionsSource;
}

/** A Standard Rejection declaration as written, before the structure rule has judged it. */
type WrittenStandardRejection = Omit<LocatedStandardRejection, 'declaration'> & {
  readonly declaration: unknown;
};

function standardRejectionsOf({
  definitions,
}: NamedDefinitions): readonly LocatedStandardRejection[] {
  const entries: readonly WrittenStandardRejection[] = entriesOf(
    definitions.standardRejections,
  ).map(([name, declaration]) => ({
    at: placeOf({ kind: 'standard-rejection', name }, definitions),
    name,
    declaration,
  }));
  return entries.filter(isLocatedStandardRejection);
}

/** A declared Standard Rejection is an object; what else sits there is the structure rule's. */
function isLocatedStandardRejection(
  entry: WrittenStandardRejection,
): entry is LocatedStandardRejection {
  return isPlainObject(entry.declaration);
}

function namedSourceOf(root: Root): NamedDefinitions | undefined {
  const definitions = standardRejectionsSourceOf(root);
  if (definitions === undefined) {
    return undefined;
  }
  return { at: inFields(placeOf({ kind: 'root' }, root), 'standardRejections'), definitions };
}

/**
 * The Definitions object a Contract names as `standardRejections`, whatever a Root file exported;
 * none for any other Root, or when what it names is no Definitions object, which the structure
 * rule reports.
 */
export function standardRejectionsSourceOf(root: unknown): Definitions | undefined {
  if (!isServiceContract(root)) {
    return undefined;
  }
  const named: unknown = root.standardRejections;
  return isDefinitions(named) ? named : undefined;
}

/** Each Dependency at its place in the Root's list, since a Dependency has no name of its own. */
function dependenciesOf(root: Root): readonly LocatedDependency[] {
  if (root.kind === 'definitions') {
    return [];
  }
  const holder = placeOf({ kind: 'root' }, root);
  const written = listOf(root.dependencies).map((dependency: unknown, index) => {
    const at = placedIn({ holder, field: 'dependencies', index }, dependency, undefined);
    return { at, dependency };
  });
  return written.filter(isLocatedDependency);
}

/** What sits where a Dependency belongs and is none is the structure rule's. */
function isLocatedDependency(written: {
  readonly at: Place;
  readonly dependency: unknown;
}): written is LocatedDependency {
  return isDependency(written.dependency);
}
