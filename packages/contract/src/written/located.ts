import type {
  Application,
  Command,
  Contract,
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
import type { Path } from '../walker/index.ts';

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

/**
 * A Guard the root reaches, where it sits by name, since Endpoints and other Guards only
 * reference it: an Endpoint attaches it, directly or through a Guard's `guards`, or a Definitions
 * root exports it.
 */
export type LocatedGuard = { readonly at: Path; readonly guard: Guard };

/** A Rejection and where it sits, by code, since Endpoints and Guards only reference it. */
export type LocatedRejection = { readonly at: Path; readonly rejection: Rejection };

/**
 * A code the root reaches and every declaration of it, which a valid root has one of, in the
 * root's order: a Definitions root's exports, then the Guards', then the Endpoints'.
 */
export type LocatedCode = {
  readonly code: string;
  readonly at: Path;
  readonly rejections: readonly [LocatedRejection, ...LocatedRejection[]];
};

/** The Definitions Package that declares a root's Standard Rejections, and where it sits: named by a Contract at `['standardRejections']`, or the Definitions root itself at `[]`. */
export type NamedDefinitions = { readonly at: Path; readonly definitions: Definitions };

/**
 * A Dependency and where it sits in its root, by its Provider's name, or by its position when its
 * provider has none: `['dependencies', 'orders-service']`.
 */
export type LocatedDependency = { readonly at: Path; readonly dependency: Dependency };

/** A Standard Rejection as a Definitions Package declares it, by name, and where it sits. */
export type LocatedStandardRejection = {
  readonly at: Path;
  readonly name: string;
  readonly declaration: StandardRejectionDeclaration<number>;
};

/**
 * An Event's Message Version, its Group, and where it sits in its root, under its Group and by
 * identity: `['groups', <group>, 'events', 'OrderCreated@2']`.
 */
export type LocatedEvent = { readonly at: Path; readonly event: Event; readonly group: Group };

/**
 * A Command's Message Version, its Group, and where it sits in its root, under its Group and by
 * identity: `['groups', <group>, 'commands', 'ChargeCard@1']`.
 */
export type LocatedCommand = {
  readonly at: Path;
  readonly command: Command;
  readonly group: Group;
};

/**
 * A Subscription, its Group, and where it sits in its root, under its Group and by name:
 * `['groups', <group>, 'subscriptions', 'notifyOnSettled']`.
 */
export type LocatedSubscription = {
  readonly at: Path;
  readonly subscription: Subscription;
  readonly group: Group;
};
