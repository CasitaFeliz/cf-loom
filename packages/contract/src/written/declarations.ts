import type { Contract, Definitions, Endpoint } from '../declarations/index.ts';
import {
  isContract,
  isDefinitions,
  isDependencies,
  isEndpoint,
  isGroup,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { identityOf } from './identity.ts';
import type {
  LocatedCode,
  LocatedCommand,
  LocatedDefinitions,
  LocatedDependencies,
  LocatedEndpoint,
  LocatedEvent,
  LocatedGroup,
  LocatedGuard,
  LocatedRejection,
  LocatedStandardRejection,
  LocatedSubscription,
  Root,
} from './located.ts';
import { messagesOf } from './messages.ts';
import { codesOf, guardsOf, rejectionsOf } from './references.ts';
import { entriesOf, isPlainObject, listOf, textOf } from './written.ts';

/**
 * Every declaration of a root, each once, with where it sits, so each rule reads one list; what
 * sits where a declaration belongs and is none is left out here and reported by the structure rules.
 */
export type Declarations = {
  readonly root: Root;
  /** Every Definitions Package in play: the ones a Contract lists, or the root itself when it is one. */
  readonly allPackages: readonly LocatedDefinitions[];
  /** The Definitions Packages a Contract lists; never the root. */
  readonly listedDefinitions: readonly LocatedDefinitions[];
  readonly groups: readonly LocatedGroup[];
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly LocatedGuard[];
  /** Every Rejection, each once, in the root's order. */
  readonly rejections: readonly LocatedRejection[];
  /** Every code, each once, with every declaration of it. */
  readonly codes: readonly LocatedCode[];
  readonly standardRejections: readonly LocatedStandardRejection[];
  readonly dependencies: readonly LocatedDependencies[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly LocatedSubscription[];
};

/** Gathers what a root declares, Guards and Rejections included, each where it was first met. */
export function declarationsOf(root: Root): Declarations {
  const listedDefinitions = definitionsOf(root);
  const groups = groupsOf(root);
  const endpoints = distinctEndpoints(groups.flatMap(locatedEndpointsOf));
  const allPackages =
    root.kind === 'definitions' ? [{ at: [], definitions: root }] : listedDefinitions;
  const sources = { root, allPackages, endpoints };
  const guards = guardsOf(sources);
  const rejections = rejectionsOf(sources, guards);
  return {
    root,
    allPackages,
    listedDefinitions,
    groups,
    endpoints,
    guards,
    rejections,
    codes: codesOf(sources, { guards, rejections }),
    standardRejections: allPackages.flatMap(standardRejectionsOf),
    dependencies: dependenciesOf(root),
    ...messagesOf(root),
  };
}

/** Every Endpoint a Contract lists through its Groups, each once, in the root's order. */
export function endpointsOf(contract: Contract): readonly Endpoint[] {
  const located = distinctEndpoints(groupsOf(contract).flatMap(locatedEndpointsOf));
  return located.map(({ endpoint }) => endpoint);
}

/** Where an Endpoint sits under its Group: the one place that spells an Endpoint's location. */
export function endpointAt(groupAt: Path, endpoint: Endpoint): Path {
  return [...groupAt, 'endpoints', identityOf(endpoint.method, endpoint.path)];
}

/** An Endpoint listed twice is one Endpoint, where first met; the Groups rule reports the repeat. */
function distinctEndpoints(endpoints: readonly LocatedEndpoint[]): readonly LocatedEndpoint[] {
  const seen = new Set<Endpoint>();
  const distinct: LocatedEndpoint[] = [];
  for (const located of endpoints) {
    if (!seen.has(located.endpoint)) {
      seen.add(located.endpoint);
      distinct.push(located);
    }
  }
  return distinct;
}

/** A Standard Rejection declaration as written, before the structure rule has judged it. */
type WrittenStandardRejection = Omit<LocatedStandardRejection, 'declaration'> & {
  readonly declaration: unknown;
};

function standardRejectionsOf(listedIn: LocatedDefinitions): readonly LocatedStandardRejection[] {
  const { at, definitions } = listedIn;
  const entries: readonly WrittenStandardRejection[] = entriesOf(
    definitions.standardRejections,
  ).map(([name, declaration]) => ({
    at: [...at, 'standardRejections', name],
    name,
    declaration,
    listedIn,
  }));
  return entries.filter(isLocatedStandardRejection);
}

/** A declared Standard Rejection is an object; what else sits there is the structure rule's. */
function isLocatedStandardRejection(
  entry: WrittenStandardRejection,
): entry is LocatedStandardRejection {
  return isPlainObject(entry.declaration);
}

/**
 * The Definitions Packages a Contract lists, whatever a root file exported: the CLI resolves them
 * before validating; what else sits there is the structure rules' to report.
 */
export function listedDefinitionsOf(root: unknown): readonly Definitions[] {
  return isContract(root) ? listOf(root.definitions).filter(isDefinitions) : [];
}

function definitionsOf(root: Root): readonly LocatedDefinitions[] {
  return listedDefinitionsOf(root).map((definitions) => ({
    at: ['definitions', textOf(definitions.name)],
    definitions,
  }));
}

function groupsOf(root: Root): readonly LocatedGroup[] {
  if (root.kind !== 'contract') {
    return [];
  }
  return listOf(root.groups)
    .filter(isGroup)
    .map((group) => ({ at: ['groups', textOf(group.name)], group }));
}

function locatedEndpointsOf({ at, group }: LocatedGroup): readonly LocatedEndpoint[] {
  return listOf(group.endpoints)
    .filter(isEndpoint)
    .map((endpoint) => ({ at: endpointAt(at, endpoint), endpoint, group }));
}

function dependenciesOf(root: Root): readonly LocatedDependencies[] {
  if (root.kind === 'definitions') {
    return [];
  }
  return listOf(root.dependencies)
    .filter(isDependencies)
    .map((dependencies) => ({
      at: ['dependencies', textOf(dependencies.provider)],
      dependencies,
    }));
}
