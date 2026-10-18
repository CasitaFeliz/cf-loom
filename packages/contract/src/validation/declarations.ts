import type { Attachment } from '../attachment.ts';
import type { Definitions } from '../definitions.ts';
import type { Dependencies } from '../dependencies.ts';
import type { Endpoint } from '../endpoint.ts';
import type { Group } from '../group.ts';
import type { Guard } from '../guard.ts';
import type { Rejection } from '../rejection.ts';
import type { Application, Contract } from '../roots.ts';
import type { StandardRejectionDeclaration } from '../standard-rejections.ts';
import type { Path } from '../walker/nodes.ts';

/** What `generate` runs for: a Service's Contract, an Application's, or a Definitions Package. */
export type Root = Contract | Application | Definitions;

/** A Group and where it sits in its root. */
export type LocatedGroup = { readonly at: Path; readonly group: Group };

/** An Endpoint and where it sits in its root, under its Group. */
export type LocatedEndpoint = { readonly at: Path; readonly endpoint: Endpoint };

/** A Guard and where it sits: by name, since Endpoints and other Guards only reference it. */
export type LocatedGuard = { readonly at: Path; readonly guard: Guard };

/** A Rejection and where it sits: by code, since Endpoints and Guards only reference it. */
export type LocatedRejection = { readonly at: Path; readonly rejection: Rejection };

/** A listed Definitions Package and where it sits in its root. */
export type LocatedDefinitions = { readonly at: Path; readonly definitions: Definitions };

/** A Dependency and where it sits in its root, by Provider. */
export type LocatedDependencies = { readonly at: Path; readonly dependencies: Dependencies };

/** A Standard Rejection as a Definitions Package declares it, by name, and where it sits. */
export type LocatedStandardRejection = {
  readonly at: Path;
  readonly name: string;
  readonly declaration: StandardRejectionDeclaration<number>;
};

/** Every declaration of a root, each once, with where it sits, so each rule reads one list. */
export type Declarations = {
  readonly root: Root;
  readonly groups: readonly LocatedGroup[];
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly LocatedGuard[];
  readonly rejections: readonly LocatedRejection[];
  readonly definitions: readonly LocatedDefinitions[];
  readonly standardRejections: readonly LocatedStandardRejection[];
  readonly dependencies: readonly LocatedDependencies[];
};

/** Gathers what a root declares, Guards and Rejections included, each where it was first met. */
export function declarationsOf(root: Root): Declarations {
  const definitions = definitionsOf(root);
  const groups = groupsOf(root);
  const endpoints = distinctEndpoints(groups.flatMap(endpointsOf));
  const packages = root.kind === 'definitions' ? [{ at: [], definitions: root }] : definitions;
  const guards = guardsOf(packages.map(packageOf), endpoints);
  const rejections = rejectionsOf({ packages: packages.map(packageOf), guards, endpoints });
  return {
    root,
    groups,
    endpoints,
    guards,
    rejections,
    definitions,
    standardRejections: packages.flatMap(standardRejectionsOf),
    dependencies: dependenciesOf(root),
  };
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

function standardRejectionsOf({
  at,
  definitions,
}: LocatedDefinitions): readonly LocatedStandardRejection[] {
  const declared = definitions.standardRejections ?? {};
  const entries = Object.entries(declared).filter(([, declaration]) => declaration !== undefined);
  return entries.map(([name, declaration]) => ({
    at: [...at, 'standardRejections', name],
    name,
    declaration,
  }));
}

/** The Guard an Attachment names, bare or qualified; nothing when it names no Guard at all. */
export function attachedGuardOf(attachment: Attachment): Guard | undefined {
  if (isGuard(attachment)) {
    return attachment;
  }
  if (typeof attachment === 'object' && attachment !== null && isGuard(attachment.guard)) {
    return attachment.guard;
  }
  return undefined;
}

/** Whether a value is a declared Guard, from any copy of this package. */
export function isGuard(value: unknown): value is Guard {
  return isDeclaration(value) && value.kind === 'guard';
}

/** Whether a value is a declared Rejection, from any copy of this package. */
export function isRejection(value: unknown): value is Rejection {
  return isDeclaration(value) && value.kind === 'rejection';
}

/** Whether a value is a declared Endpoint, from any copy of this package. */
export function isEndpoint(value: unknown): value is Endpoint {
  return isDeclaration(value) && value.kind === 'endpoint';
}

function isDeclaration(value: unknown): value is { readonly kind: unknown } {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

function definitionsOf(root: Root): readonly LocatedDefinitions[] {
  if (root.kind !== 'contract') {
    return [];
  }
  return listOf(root.definitions).map((definitions) => ({
    at: ['definitions', definitions.name],
    definitions,
  }));
}

function groupsOf(root: Root): readonly LocatedGroup[] {
  if (root.kind !== 'contract') {
    return [];
  }
  return listOf(root.groups).map((group) => ({ at: ['groups', group.name], group }));
}

function endpointsOf({ at, group }: LocatedGroup): readonly LocatedEndpoint[] {
  return listOf(group.endpoints).map((endpoint) => ({
    at: [...at, 'endpoints', endpoint.name],
    endpoint,
  }));
}

function dependenciesOf(root: Root): readonly LocatedDependencies[] {
  if (root.kind === 'definitions') {
    return [];
  }
  return listOf(root.dependencies).map((dependencies) => ({
    at: ['dependencies', dependencies.provider],
    dependencies,
  }));
}

function packageOf(located: LocatedDefinitions): Definitions {
  return located.definitions;
}

/** Every Guard a root reaches, each once, the Guards one lists before it. */
function guardsOf(
  packages: readonly Definitions[],
  endpoints: readonly LocatedEndpoint[],
): readonly LocatedGuard[] {
  const listed = packages.flatMap((definitions) => listOf(definitions.guards));
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
  gathered.push({ at: ['guards', guard.name], guard });
}

/** Every Rejection a root reaches, each once: a Definitions Package's, a Guard's, an Endpoint's. */
function rejectionsOf(
  declared: Pick<Declarations, 'guards' | 'endpoints'> & {
    readonly packages: readonly Definitions[];
  },
): readonly LocatedRejection[] {
  const listed = declared.packages.flatMap((definitions) => listOf(definitions.rejections));
  const ofGuards = declared.guards.flatMap((located) => listOf(located.guard.rejections));
  const ofEndpoints = declared.endpoints.flatMap((located) => listOf(located.endpoint.rejections));
  const rejections = [...listed, ...ofGuards, ...ofEndpoints].filter(isRejection);
  const distinct = [...new Set(rejections)];
  return distinct.map((rejection) => ({ at: ['rejections', rejection.code], rejection }));
}

/** A list a declaration may leave out is empty; what a cast put there that is no list is too. */
export function listOf<Item>(list: readonly Item[] | undefined): readonly Item[] {
  return Array.isArray(list) ? list : [];
}
