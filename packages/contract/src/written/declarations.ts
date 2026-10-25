import type { Definitions, Dependency } from '../declarations/index.ts';
import { isContract, isDefinitions, isDependency } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { groupedOf, groupsOf } from './grouped.ts';
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
  Root,
} from './located.ts';
import { type Members, membersOf } from './members.ts';
import { codesOf, guardsOf, rejectionsOf } from './references.ts';
import { entriesOf, isPlainObject, listOf, partOf } from './written.ts';

/**
 * Every declaration of a root, each once, with where it sits, so each rule reads one list; what
 * sits where a declaration belongs and is none is left out here and reported by the structure rules.
 */
export type Declarations = {
  readonly root: Root;
  /** What a Definitions root's file exports that it shares; none for another root. */
  readonly ownMembers: Members | undefined;
  /** The Definitions Package a Contract names as `standardRejections`, at `['standardRejections']`; none for another root. */
  readonly standardRejectionsSource: NamedDefinitions | undefined;
  readonly groups: readonly LocatedGroup[];
  readonly endpoints: readonly LocatedEndpoint[];
  /** Every Guard the root reaches, each once. */
  readonly guards: readonly LocatedGuard[];
  /** Every Rejection the root reaches, each once, in the root's order. */
  readonly rejections: readonly LocatedRejection[];
  /** Every code the root reaches, each once, with every declaration of it. */
  readonly codes: readonly LocatedCode[];
  /** The Standard Rejections the root's declaring package declares. */
  readonly standardRejections: readonly LocatedStandardRejection[];
  readonly dependencies: readonly LocatedDependency[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly LocatedSubscription[];
};

/**
 * Gathers what a root reaches, Guards and Rejections included, each where it was first met: what
 * its Endpoints reach, and for a Definitions root the members its file exports, by `rootExports`.
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
 * The Definitions Package whose `standardRejections` a root's Standard Rejections come from: the
 * one a Contract names, or a Definitions root itself.
 */
export function standardRejectionsDeclarerOf({
  root,
  standardRejectionsSource,
}: Pick<Declarations, 'root' | 'standardRejectionsSource'>): NamedDefinitions | undefined {
  return root.kind === 'definitions' ? { at: [], definitions: root } : standardRejectionsSource;
}

/** A Standard Rejection declaration as written, before the structure rule has judged it. */
type WrittenStandardRejection = Omit<LocatedStandardRejection, 'declaration'> & {
  readonly declaration: unknown;
};

function standardRejectionsOf({
  at,
  definitions,
}: NamedDefinitions): readonly LocatedStandardRejection[] {
  const entries: readonly WrittenStandardRejection[] = entriesOf(
    definitions.standardRejections,
  ).map(([name, declaration]) => ({
    at: [...at, 'standardRejections', name],
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
  return definitions === undefined ? undefined : { at: ['standardRejections'], definitions };
}

/**
 * The Definitions object a Contract names as `standardRejections`, whatever a root file exported;
 * none for any other root, or when what it names is no Definitions object, which the structure
 * rule reports.
 */
export function standardRejectionsSourceOf(root: unknown): Definitions | undefined {
  if (!isContract(root)) {
    return undefined;
  }
  const named: unknown = root.standardRejections;
  return isDefinitions(named) ? named : undefined;
}

function dependenciesOf(root: Root): readonly LocatedDependency[] {
  if (root.kind === 'definitions') {
    return [];
  }
  const written = listOf(root.dependencies).map((dependency: unknown, index) => {
    const at: Path = ['dependencies', providerNameOf(dependency) ?? index];
    return { at, dependency };
  });
  return written.filter(isLocatedDependency);
}

/** What sits where a Dependency belongs and is none is the structure rule's. */
function isLocatedDependency(written: {
  readonly at: Path;
  readonly dependency: unknown;
}): written is LocatedDependency {
  return isDependency(written.dependency);
}

/** The name of a Dependency's Provider, the Contract Package's own; none when it has no name to give. */
export function providerNameOf(dependency: unknown): string | undefined {
  const { name } = partOf<'name'>(partOf<'provider'>(dependency).provider);
  return typeof name === 'string' ? name : undefined;
}

/** The Endpoints and Events a Dependency's Provider exports; none of a kind when a cast left it out of the Contract Package. */
export function providerExportsOf(dependency: Dependency): {
  readonly endpoints: readonly unknown[];
  readonly events: readonly unknown[];
} {
  const provider = partOf<'endpoints' | 'events'>(dependency.provider);
  return {
    endpoints: Object.values(partOf(provider.endpoints)),
    events: Object.values(partOf(provider.events)),
  };
}
