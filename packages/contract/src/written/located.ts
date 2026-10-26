import type {
  Command,
  Definitions,
  Dependency,
  Endpoint,
  Event,
  Group,
  Guard,
  Rejection,
  StandardRejectionDeclaration,
  Subscription,
} from '../declarations/index.ts';
import type { Place } from '../walker/index.ts';

/** A Group and where it sits in its Root: at its name, else at the Root's list of Groups. */
export type LocatedGroup = { readonly at: Place; readonly group: Group };

/**
 * An Endpoint, its Group, and where it sits: at its identity with its name, else at its Group's
 * list of Endpoints, by its position there.
 */
export type LocatedEndpoint = {
  readonly at: Place;
  readonly endpoint: Endpoint;
  readonly group: Group;
};

/**
 * A Guard the Root reaches, where it sits by name, since Endpoints and other Guards only
 * reference it: an Endpoint attaches it, directly or through a Guard's `guards`, or a Definitions
 * Package exports it.
 */
export type LocatedGuard = { readonly at: Place; readonly guard: Guard };

/** A Rejection and where it sits, by code, since Endpoints and Guards only reference it. */
export type LocatedRejection = { readonly at: Place; readonly rejection: Rejection };

/**
 * A code the Root reaches and every declaration of it, which a valid Root has one of, in the
 * Root's order: a Definitions Package's exports, then the Guards', then the Endpoints'.
 */
export type LocatedCode = {
  readonly code: string;
  readonly at: Place;
  readonly rejections: readonly [LocatedRejection, ...LocatedRejection[]];
};

/** The Definitions Package that declares a Root's Standard Rejections, and where it sits: named by a Contract in its `standardRejections` field, or the Definitions Package itself. */
export type NamedDefinitions = { readonly at: Place; readonly definitions: Definitions };

/**
 * A Dependency and where it sits in its Root, by its Provider's name, or by its position in the
 * Root's list of Dependencies when its Provider has none.
 */
export type LocatedDependency = { readonly at: Place; readonly dependency: Dependency };

/** A Standard Rejection as a Definitions Package declares it, by name, and where it sits. */
export type LocatedStandardRejection = {
  readonly at: Place;
  readonly name: string;
  readonly declaration: StandardRejectionDeclaration<number>;
};

/** An Event's Message Version, its Group, and where it sits, by identity. */
export type LocatedEvent = { readonly at: Place; readonly event: Event; readonly group: Group };

/** A Command's Message Version, its Group, and where it sits, by identity. */
export type LocatedCommand = {
  readonly at: Place;
  readonly command: Command;
  readonly group: Group;
};

/**
 * A Subscription, its Group, and where it sits, by name, else at its Group's list of
 * Subscriptions, by its position there.
 */
export type LocatedSubscription = {
  readonly at: Place;
  readonly subscription: Subscription;
  readonly group: Group;
};
