import { type Endpoint, isEndpoint, type Root } from '../declarations/index.ts';
import type { Place } from '../walker/index.ts';
import {
  type Declarations,
  eventServiceOf,
  type LocatedCommand,
  type LocatedEndpoint,
  type LocatedEvent,
  type LocatedGroup,
  type LocatedGuard,
  type LocatedRejection,
  type LocatedSubscription,
  type Members,
  type ResolvedStandard,
  resolvedStandards,
} from '../written/index.ts';
import { contractPackageOf, type UsedProvider, usedProvidersOf } from './dependency-packages.ts';
import { definitionsPackageOf } from './provenance.ts';
import type {
  ImportedContractPackage,
  ImportedDefinitions,
  ResolvedContractPackage,
  ResolvedDefinitions,
  RootPackage,
} from './validate.ts';

/** A Guard a valid Root reaches, and the Definitions Package it belongs to; none for the Root's own. */
export type ValidatedGuard = LocatedGuard & { readonly from: ResolvedDefinitions | undefined };

/**
 * A code a valid Root reaches: its one declaration, where it sits, and the Definitions Package
 * that declaration belongs to; none for the Root's own.
 */
export type ValidatedCode = {
  readonly code: string;
  readonly at: Place;
  readonly rejection: LocatedRejection['rejection'];
  readonly from: ResolvedDefinitions | undefined;
};

/**
 * A Provider a valid Root uses, by its Dependencies or its Subscriptions: its name, the Endpoints
 * its Dependencies list, each once, and the installed Contract Package its Elements come from,
 * which its package.json names.
 */
export type ValidatedProvider = {
  readonly name: string;
  readonly endpoints: readonly Endpoint[];
  readonly from: ResolvedContractPackage;
};

/** A Subscription of a valid Root and the Service whose Event it receives, its own included. */
export type ValidatedSubscription = LocatedSubscription & { readonly service: string };

/**
 * The declarations of a valid Root as gathered, in the Root's order: the Root itself, its Groups,
 * Endpoints by identity, the Guards and codes it reaches, each code with its one declaration and
 * the Definitions Package each came from, the Standard Rejections resolved, the Providers it uses,
 * each with the installed Contract Package its Elements come from, and the Message Versions and
 * Subscriptions. The Snapshot's writer puts them in canonical form.
 */
export type ValidatedDeclarations = {
  readonly root: Root;
  /** The package.json name of the package the Root sits in, scope included. */
  readonly packageName: string;
  /** What a Definitions Package's Root file exports that it shares; none for another Root. */
  readonly ownMembers: Members | undefined;
  readonly groups: readonly LocatedGroup[];
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly ValidatedGuard[];
  readonly codes: readonly ValidatedCode[];
  readonly standardRejections: readonly ResolvedStandard[];
  /** The installed package a Contract names as `standardRejections`; none for cf-loom's defaults or a Definitions Package's own. */
  readonly standardRejectionsSource: ResolvedDefinitions | undefined;
  readonly providers: readonly ValidatedProvider[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly ValidatedSubscription[];
};

/** What a valid Root declares, so the Snapshot's writer never gathers it again. */
export function validatedDeclarationsOf(
  declarations: Declarations,
  { packageName, packages, contractPackages }: Omit<RootPackage, 'rootExports'>,
): ValidatedDeclarations {
  const { root, ownMembers, standardRejectionsSource } = declarations;
  const fromOf = (declaration: unknown) => foundIn(packages, declaration);
  const named = standardRejectionsSource?.definitions;
  return {
    root,
    packageName,
    ownMembers,
    groups: declarations.groups,
    endpoints: declarations.endpoints,
    guards: declarations.guards.map((located) => ({ ...located, from: fromOf(located.guard) })),
    codes: declarations.codes.map(({ code, at, rejections: [first] }) => ({
      code,
      at,
      rejection: first.rejection,
      from: fromOf(first.rejection),
    })),
    standardRejections: resolvedStandards(declarations),
    standardRejectionsSource: named === undefined ? undefined : fromOf(named),
    providers: usedProvidersOf(declarations).map((provider) =>
      validatedProviderOf(provider, contractPackages),
    ),
    events: declarations.events,
    commands: declarations.commands,
    subscriptions: validatedSubscriptionsOf(declarations),
  };
}

/** Each Subscription with its Event's Service, resolved once; a valid Root's always has one. */
function validatedSubscriptionsOf({
  root,
  subscriptions,
}: Declarations): readonly ValidatedSubscription[] {
  return subscriptions.map((located) => {
    const service = eventServiceOf(root, located.subscription.event);
    if (service === undefined) {
      throw new Error('A valid Root subscribed to an Event of no Service: a bug.');
    }
    return { ...located, service };
  });
}

/** The Definitions Package a declaration belongs to, when exactly one does. */
function foundIn(packages: readonly ImportedDefinitions[], declaration: unknown) {
  const provenance = definitionsPackageOf(packages, declaration);
  if (provenance.kind !== 'origin' || provenance.package.kind !== 'identified') {
    return undefined;
  }
  return provenance.package;
}

/** A Provider with the one installed package its Elements come from; a valid Root's always has one. */
function validatedProviderOf(
  provider: UsedProvider,
  contractPackages: readonly ImportedContractPackage[],
): ValidatedProvider {
  const provenance = contractPackageOf(contractPackages, provider);
  if (provenance.kind !== 'origin' || provenance.package.kind !== 'identified') {
    throw new Error('A valid Root uses a Provider of no installed package: a bug.');
  }
  const endpoints = provider.elements.filter(isEndpoint);
  return { name: provider.name, endpoints, from: provenance.package };
}
