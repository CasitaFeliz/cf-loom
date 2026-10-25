import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  eventServiceOf,
  type LocatedCommand,
  type LocatedDefinitions,
  type LocatedDependency,
  type LocatedEndpoint,
  type LocatedEvent,
  type LocatedGroup,
  type LocatedGuard,
  type LocatedRejection,
  type LocatedSubscription,
  type Members,
  type ResolvedStandard,
  type Root,
  resolvedStandards,
} from '../written/index.ts';
import type { RootPackage } from './validate.ts';

/**
 * A Guard of a valid root, whether the root reaches it, and the listed Definitions Package that
 * lists it, which says where it came from; none for the root's own.
 */
export type ValidatedGuard = LocatedGuard & { readonly listedIn: LocatedDefinitions | undefined };

/**
 * A code of a valid root: its first declaration, where it sits, whether the root reaches it, and
 * the listed Definitions Package that lists that declaration; none for the root's own.
 */
export type ValidatedCode = {
  readonly code: string;
  readonly at: Path;
  readonly rejection: LocatedRejection['rejection'];
  readonly reached: boolean;
  readonly listedIn: LocatedDefinitions | undefined;
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
  readonly dependencies: readonly LocatedDependency[];
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly ValidatedSubscription[];
};

/** What a valid root declares, so the Snapshot's writer never gathers it again. */
export function validatedDeclarationsOf(
  declarations: Declarations,
  { packageName, exportsOf }: Pick<RootPackage, 'packageName' | 'exportsOf'>,
): ValidatedDeclarations {
  const { root } = declarations;
  return {
    root,
    packageName,
    exports: root.kind === 'definitions' ? exportsOf(root) : {},
    groups: declarations.groups,
    endpoints: declarations.endpoints,
    guards: declarations.guards.map((located) => ({
      ...located,
      listedIn: listedInOf(declarations, located.guard, (members) => members.guards),
    })),
    codes: declarations.codes.map(({ code, at, rejections: [first], reached }) => ({
      code,
      at,
      rejection: first.rejection,
      reached,
      listedIn: listedInOf(declarations, first.rejection, (members) => members.rejections),
    })),
    standardRejections: resolvedStandards(declarations),
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

/** The first listed Definitions Package whose members hold a declaration; none for the root's own. */
function listedInOf(
  { listedDefinitions }: Declarations,
  declaration: unknown,
  held: (members: Members) => readonly unknown[],
): LocatedDefinitions | undefined {
  return listedDefinitions.find(({ members }) => held(members).includes(declaration));
}
