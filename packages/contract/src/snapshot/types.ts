import type { Lifecycle, StandardRejectionName, Visibility } from '../declarations/index.ts';
import type { ObjectNode, Origin, SchemaNode } from '../walker/index.ts';

/** The versions of SNAPSHOT.md a Snapshot may follow, as values, so a reader knows every format it ever wrote. */
export const snapshotFormats = [1] as const;

/** The version of SNAPSHOT.md a Snapshot follows, so a reader knows every format it ever wrote. */
export type SnapshotFormat = (typeof snapshotFormats)[number];

/** The format `generate` and `publish` write, the one place that names it. */
export const writtenSnapshotFormat = 1 satisfies SnapshotFormat;

/** A Guard as an Endpoint attaches it: by name, with its Qualifier as written, or `null`. */
export type AttachmentSnapshot = { readonly guard: string; readonly qualifier: unknown };

/**
 * What a Caller sends to an Endpoint: its path params and body, `null` when it accepts none, and
 * its query and headers, objects with no field when it declares none.
 */
export type InputSnapshot = {
  readonly params: ObjectNode | null;
  readonly query: ObjectNode;
  readonly headers: ObjectNode;
  readonly body: SchemaNode | null;
};

/** What an Endpoint answers when it does what was asked. */
export type SuccessSnapshot = {
  readonly status: number;
  readonly headers: ObjectNode;
  readonly body: SchemaNode | null;
};

/** An Endpoint by its identity, its Input merged with its Guards' demands and its codes resolved. */
export type EndpointSnapshot = {
  readonly name: string;
  readonly group: string;
  readonly visibility: Visibility;
  readonly lifecycle: Lifecycle;
  readonly description: string;
  readonly params: readonly string[];
  readonly guards: readonly AttachmentSnapshot[];
  readonly input: InputSnapshot;
  readonly success: SuccessSnapshot;
  readonly rejections: readonly string[];
  readonly deprecatedAt?: string;
};

/** A Guard: what it demands, the Guards it reads, its Qualifier's schema and its codes. */
export type GuardSnapshot = {
  readonly origin: Origin;
  readonly description: string;
  readonly guards: readonly string[];
  readonly qualifier: SchemaNode | null;
  readonly demands: { readonly headers: ObjectNode; readonly query: ObjectNode };
  readonly context: SchemaNode | null;
  readonly rejections: readonly string[];
};

/**
 * A code with its declaration's status, message, body shape and headers, an object with no field
 * when it declares none.
 */
export type CodeSnapshot = {
  readonly origin: Origin;
  readonly status: number;
  readonly message: string;
  readonly headers: ObjectNode;
  readonly body: SchemaNode | null;
};

/** The code each Standard Rejection resolved to; its status, message, origin and body are that code's, under `codes`. */
export type StandardRejectionsSnapshot = Readonly<Record<StandardRejectionName, string>>;

/** A Message Version by its identity, with the Group that lists it. */
export type EventSnapshot = {
  readonly group: string;
  readonly visibility: Visibility;
  readonly lifecycle: Lifecycle;
  readonly description: string;
  readonly body: SchemaNode;
};

/** A Command Version by its identity; a Command is always Private. */
export type CommandSnapshot = Omit<EventSnapshot, 'visibility'>;

/** A Subscription by its name, with the Group that lists it, what it is for and the Event it receives. */
export type SubscriptionSnapshot = {
  readonly group: string;
  readonly description: string;
  readonly event: string;
};

/** A Group by its name: what it is for, which is all a Snapshot keeps of it; each Element and Subscription it lists names it. */
export type GroupSnapshot = { readonly description: string };

/** What a Contract uses of one Provider: the version it relied on and the Endpoints it selects. */
export type DependencySnapshot = {
  readonly against: string;
  readonly endpoints: readonly { readonly id: string; readonly name: string }[];
};

/** What every declared Snapshot starts with; `version` and `generator` are left to `package` and `publish`. */
type Heading<Kind extends string> = {
  readonly format: SnapshotFormat;
  readonly kind: Kind;
  readonly name: string;
};

/** A map of a Snapshot, keyed by identity or name. */
export type ByKey<Value> = Readonly<Record<string, Value>>;

/** The declared Snapshot of a Service's Contract. */
export type ServiceSnapshot = Heading<'service'> & {
  readonly standardRejections: StandardRejectionsSnapshot;
  readonly groups: ByKey<GroupSnapshot>;
  readonly defs: ByKey<SchemaNode>;
  readonly endpoints: ByKey<EndpointSnapshot>;
  readonly events: ByKey<EventSnapshot>;
  readonly commands: ByKey<CommandSnapshot>;
  readonly guards: ByKey<GuardSnapshot>;
  readonly codes: ByKey<CodeSnapshot>;
  readonly subscriptions: ByKey<SubscriptionSnapshot>;
  readonly dependencies: ByKey<DependencySnapshot>;
};

/** The declared Snapshot of an Application, which holds only its Dependencies. */
export type ApplicationSnapshot = Heading<'application'> & {
  readonly dependencies: ByKey<DependencySnapshot>;
};

/** One export of a Definitions Package: a Guard by name, a Rejection by code, or a shared schema's node. */
export type ExportSnapshot =
  | { readonly kind: 'guard'; readonly guard: string }
  | { readonly kind: 'rejection'; readonly code: string }
  | { readonly kind: 'schema'; readonly schema: SchemaNode };

/** The declared Snapshot of a Definitions Package: everything its Root file exports, and what that reaches. */
export type DefinitionsSnapshot = Heading<'definitions'> & {
  readonly standardRejections: StandardRejectionsSnapshot;
  readonly defs: ByKey<SchemaNode>;
  readonly exports: ByKey<ExportSnapshot>;
  readonly guards: ByKey<GuardSnapshot>;
  readonly codes: ByKey<CodeSnapshot>;
};

/** A declared Snapshot, as `generate` writes it to `contract.snapshot.json`. */
export type Snapshot = ServiceSnapshot | ApplicationSnapshot | DefinitionsSnapshot;

/** A declared Endpoint a Contract Package does not export, as routing needs it: only whether it is Retired. */
export type ShadowingSnapshot = Pick<EndpointSnapshot, 'lifecycle'>;

/**
 * The Snapshot cut to everything a Contract Package exports: its Public and Internal Endpoints and
 * Events that are not Retired, with the Guards, codes and defs they reach, so no Private Element's
 * shapes reach a browser. `cf-loom package` writes the package's code from it.
 */
export type WholeExportedSnapshot = Pick<
  ServiceSnapshot,
  'format' | 'defs' | 'endpoints' | 'events' | 'guards' | 'codes'
>;

/**
 * The exported Snapshot cut to one Endpoint, as that Endpoint carries it: its entry and the Guards,
 * codes and defs it reaches, no Event, and under `shadowing`, keyed by identity, the other declared
 * Endpoints that win a URL it matches, so a fake routes a request it matches as `serve` does.
 */
export type ExportedSnapshot = WholeExportedSnapshot & {
  readonly shadowing: ByKey<ShadowingSnapshot>;
};
