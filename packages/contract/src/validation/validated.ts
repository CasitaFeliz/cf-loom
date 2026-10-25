import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  eventServiceOf,
  type LocatedCommand,
  type LocatedDependency,
  type LocatedEndpoint,
  type LocatedEvent,
  type LocatedGroup,
  type LocatedGuard,
  type LocatedRejection,
  type LocatedSubscription,
  type ResolvedStandard,
  type Root,
  resolvedStandards,
} from '../written/index.ts';
import { definitionsPackageOf } from './provenance.ts';
import type { ResolvedDefinitions, RootPackage } from './validate.ts';

/** A Guard a valid root reaches, and the Definitions Package it belongs to; none for the root's own. */
export type ValidatedGuard = LocatedGuard & { readonly from: ResolvedDefinitions | undefined };

/**
 * A code a valid root reaches: its one declaration, where it sits, and the Definitions Package
 * that declaration belongs to; none for the root's own.
 */
export type ValidatedCode = {
  readonly code: string;
  readonly at: Path;
  readonly rejection: LocatedRejection['rejection'];
  readonly from: ResolvedDefinitions | undefined;
};

/** A Subscription of a valid root and the Service whose Event it receives, its own included. */
export type ValidatedSubscription = LocatedSubscription & { readonly service: string };

/**
 * The declarations of a valid root as gathered, in the root's order: the root itself, its Groups,
 * Endpoints by identity, Guards and codes with whether the root reaches them, each code with its first
 * declaration, the Standard Rejections resolved, the Dependencies by Provider, and the Message
 * Versions and Subscriptions. The Snapshot's writer puts them in canonical form.
 */
export type ValidatedDeclarations = {
  readonly root: Root;
  /** The package.json name of the package the root sits in, scope included. */
  readonly packageName: string;
  /** What a Definitions root's file exports, by name: what it shares, beside the root; nothing for another root. */
  readonly exports: Readonly<Record<string, unknown>>;
  readonly groups: readonly LocatedGroup[];
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly ValidatedGuard[];
  readonly codes: readonly ValidatedCode[];
  readonly standardRejections: readonly ResolvedStandard[];
  /** The installed package a Contract takes its Standard Rejections from; none for cf-loom's defaults or a Definitions root's own. */
  readonly standardsFrom: ResolvedDefinitions | undefined;
  readonly dependencies: readonly LocatedDependency[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly ValidatedSubscription[];
};

/** What a valid root declares, so the Snapshot's writer never gathers it again. */
export function validatedDeclarationsOf(
  declarations: Declarations,
  { packageName, packages, rootExports }: RootPackage,
): ValidatedDeclarations {
  const { root, standardsSource } = declarations;
  const fromOf = (declaration: unknown) => foundIn(packages, declaration);
  const named = root.kind === 'contract' ? standardsSource?.definitions : undefined;
  return {
    root,
    packageName,
    exports: root.kind === 'definitions' ? rootExports : {},
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
    standardsFrom: named === undefined ? undefined : fromOf(named),
    dependencies: declarations.dependencies,
    events: declarations.events,
    commands: declarations.commands,
    subscriptions: validatedSubscriptionsOf(declarations),
  };
}

/** Each Subscription with its Event's Service, resolved once; a valid root's always has one. */
function validatedSubscriptionsOf({
  root,
  subscriptions,
}: Declarations): readonly ValidatedSubscription[] {
  return subscriptions.map((located) => {
    const service = eventServiceOf(root, located.subscription.event);
    if (service === undefined) {
      throw new Error('A valid root subscribed to an Event of no Service: a bug.');
    }
    return { ...located, service };
  });
}

/** The Definitions Package a declaration belongs to, when exactly one does. */
function foundIn(packages: readonly ResolvedDefinitions[], declaration: unknown) {
  const provenance = definitionsPackageOf(packages, declaration);
  return provenance.kind === 'found' ? provenance.package : undefined;
}
