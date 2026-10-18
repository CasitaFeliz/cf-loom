import type { Attachment } from '../attachment.ts';
import type { Definitions } from '../definitions.ts';
import type { Dependencies } from '../dependencies.ts';
import type { Endpoint } from '../endpoint.ts';
import type { Group } from '../group.ts';
import type { Guard } from '../guard.ts';
import {
  isDefinitions,
  isDependencies,
  isEndpoint,
  isGroup,
  isGuard,
  isRejection,
} from '../predicates.ts';
import type { Rejection } from '../rejection.ts';
import type { Application, Contract } from '../roots.ts';
import type { StandardRejectionDeclaration } from '../standard-rejections.ts';
import type { Path } from '../walker/nodes.ts';
import { identityOf } from './identity.ts';
import { entriesOf, isPlainObject, listOf, textOf } from './written.ts';

/** What `generate` runs for: a Service's Contract, an Application's, or a Definitions Package. */
export type Root = Contract | Application | Definitions;

/** A Group and where it sits in its root: `['groups', <name>]`. */
export type LocatedGroup = { readonly at: Path; readonly group: Group };

/**
 * An Endpoint, its Group, and where it sits in its root, under its Group and by its identity,
 * since a Retired Endpoint may share its name with an Active one: `['groups', <group>,
 * 'endpoints', 'GET /orders/{}']`. A Snapshot's reader finds an Endpoint's schemas under that location.
 */
export type LocatedEndpoint = {
  readonly at: Path;
  readonly endpoint: Endpoint;
  readonly group: Group;
};

/** A Guard and where it sits, by name, since Endpoints and other Guards only reference it. */
export type LocatedGuard = { readonly at: Path; readonly guard: Guard };

/** A Rejection and where it sits, by code, since Endpoints and Guards only reference it. */
export type LocatedRejection = { readonly at: Path; readonly rejection: Rejection };

/** A Definitions Package and where it sits: listed on a Contract, or the root itself at `[]`. */
export type LocatedDefinitions = { readonly at: Path; readonly definitions: Definitions };

/** A Dependency and where it sits in its root, by Provider. */
export type LocatedDependencies = { readonly at: Path; readonly dependencies: Dependencies };

/** A Standard Rejection as a Definitions Package declares it, by name, and where it sits. */
export type LocatedStandardRejection = {
  readonly at: Path;
  readonly name: string;
  readonly declaration: StandardRejectionDeclaration<number>;
};

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
  readonly rejections: readonly LocatedRejection[];
  readonly standardRejections: readonly LocatedStandardRejection[];
  readonly dependencies: readonly LocatedDependencies[];
};

/** Gathers what a root declares, Guards and Rejections included, each where it was first met. */
export function declarationsOf(root: Root): Declarations {
  const listedDefinitions = definitionsOf(root);
  const groups = groupsOf(root);
  const endpoints = distinctEndpoints(groups.flatMap(endpointsOf));
  const allPackages =
    root.kind === 'definitions' ? [{ at: [], definitions: root }] : listedDefinitions;
  const guards = guardsOf(allPackages, endpoints);
  const rejections = rejectionsOf({ allPackages, guards, endpoints });
  return {
    root,
    allPackages,
    listedDefinitions,
    groups,
    endpoints,
    guards,
    rejections,
    standardRejections: allPackages.flatMap(standardRejectionsOf),
    dependencies: dependenciesOf(root),
  };
}

/** Where an Endpoint sits under its Group: the one place that spells an Endpoint's location. */
export function endpointAt(groupAt: Path, endpoint: Endpoint): Path {
  return [...groupAt, 'endpoints', identityOf(endpoint.method, endpoint.path)];
}

/** The Guard an Attachment names, bare or qualified; nothing when it names no Guard at all. */
export function attachedGuardOf(attachment: Attachment): Guard | undefined {
  if (isGuard(attachment)) {
    return attachment;
  }
  if (isPlainObject(attachment) && isGuard(attachment.guard)) {
    return attachment.guard;
  }
  return undefined;
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

function standardRejectionsOf({
  at,
  definitions,
}: LocatedDefinitions): readonly LocatedStandardRejection[] {
  const entries: readonly WrittenStandardRejection[] = entriesOf(
    definitions.standardRejections,
  ).map(([name, declaration]) => ({ at: [...at, 'standardRejections', name], name, declaration }));
  return entries.filter(isLocatedStandardRejection);
}

/** A declared Standard Rejection is an object; what else sits there is the structure rule's. */
function isLocatedStandardRejection(
  entry: WrittenStandardRejection,
): entry is LocatedStandardRejection {
  return isPlainObject(entry.declaration);
}

function definitionsOf(root: Root): readonly LocatedDefinitions[] {
  if (root.kind !== 'contract') {
    return [];
  }
  return listOf(root.definitions)
    .filter(isDefinitions)
    .map((definitions) => ({ at: ['definitions', textOf(definitions.name)], definitions }));
}

function groupsOf(root: Root): readonly LocatedGroup[] {
  if (root.kind !== 'contract') {
    return [];
  }
  return listOf(root.groups)
    .filter(isGroup)
    .map((group) => ({ at: ['groups', textOf(group.name)], group }));
}

function endpointsOf({ at, group }: LocatedGroup): readonly LocatedEndpoint[] {
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

/** Every Guard a root reaches, each once, the Guards one lists before it. */
function guardsOf(
  allPackages: readonly LocatedDefinitions[],
  endpoints: readonly LocatedEndpoint[],
): readonly LocatedGuard[] {
  const listed = allPackages.flatMap((located) => listOf(located.definitions.guards));
  const attached = endpoints.flatMap((located) => listOf(located.endpoint.guards));
  const named = attached.map(attachedGuardOf).filter(isGuard);
  const gathered: LocatedGuard[] = [];
  const seen = new Set<Guard>();
  for (const guard of [...listed, ...named]) {
    gatherGuard(guard, seen, gathered);
  }
  return gathered;
}

function gatherGuard(guard: Guard, seen: Set<Guard>, gathered: LocatedGuard[]): void {
  if (!isGuard(guard) || seen.has(guard)) {
    return;
  }
  seen.add(guard);
  for (const listed of listOf(guard.guards)) {
    gatherGuard(listed, seen, gathered);
  }
  gathered.push({ at: ['guards', textOf(guard.name)], guard });
}

/** Every Rejection a root reaches, each once: a Definitions Package's, a Guard's, an Endpoint's. */
function rejectionsOf(
  declared: Pick<Declarations, 'allPackages' | 'guards' | 'endpoints'>,
): readonly LocatedRejection[] {
  const listed = declared.allPackages.flatMap((located) => listOf(located.definitions.rejections));
  const ofGuards = declared.guards.flatMap((located) => listOf(located.guard.rejections));
  const ofEndpoints = declared.endpoints.flatMap((located) => listOf(located.endpoint.rejections));
  const rejections = [...listed, ...ofGuards, ...ofEndpoints].filter(isRejection);
  const distinct = [...new Set(rejections)];
  return distinct.map((rejection) => ({
    at: ['rejections', textOf(rejection.code)],
    rejection,
  }));
}
