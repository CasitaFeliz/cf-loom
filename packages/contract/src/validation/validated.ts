import type { Definitions } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  eventServiceOf,
  type LocatedCommand,
  type LocatedDefinitions,
  type LocatedDependency,
  type LocatedEndpoint,
  type LocatedEvent,
  type LocatedGuard,
  type LocatedRejection,
  type LocatedSubscription,
  listOf,
  type ResolvedStandard,
  type Root,
  resolvedStandards,
} from '../written/index.ts';

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
 * The declarations of a valid root as gathered, in the root's order: the root itself, Endpoints
 * by identity, Guards and codes with whether the root reaches them, each code with its first
 * declaration, the Standard Rejections resolved, the Dependencies by Provider, and the Message
 * Versions and Subscriptions. The Snapshot's writer puts them in canonical form.
 */
export type ValidatedDeclarations = {
  readonly root: Root;
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
export function validatedDeclarationsOf(declarations: Declarations): ValidatedDeclarations {
  return {
    root: declarations.root,
    endpoints: declarations.endpoints,
    guards: declarations.guards.map((located) => ({
      ...located,
      listedIn: listedInOf(declarations, located.guard, (definitions) => definitions.guards),
    })),
    codes: declarations.codes.map(({ code, at, rejections: [first], reached }) => ({
      code,
      at,
      rejection: first.rejection,
      reached,
      listedIn: listedInOf(declarations, first.rejection, (definitions) => definitions.rejections),
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

/** The first listed Definitions Package whose list holds a declaration; none for the root's own. */
function listedInOf(
  { listedDefinitions }: Declarations,
  declaration: unknown,
  listed: (definitions: Definitions) => readonly unknown[] | undefined,
): LocatedDefinitions | undefined {
  return listedDefinitions.find(({ definitions }) =>
    listOf(listed(definitions)).includes(declaration),
  );
}
