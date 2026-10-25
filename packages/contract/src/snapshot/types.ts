import type { Lifecycle, StandardRejectionName, Visibility } from '../declarations/index.ts';
import type { ObjectNode, Origin, SchemaNode } from '../walker/index.ts';

/** The versions of SNAPSHOT.md a Snapshot may follow, as values, so a reader knows every format it ever wrote. */
export const snapshotFormats = [1] as const;

/** The version of SNAPSHOT.md a Snapshot follows, so a reader knows every format it ever wrote. */
export type SnapshotFormat = (typeof snapshotFormats)[number];

/** A Guard as an Endpoint attaches it: by name, with its Qualifier as written, or `null`. */
export type AttachmentSnapshot = { readonly guard: string; readonly qualifier: unknown };

/** What a Caller sends to an Endpoint, each part `null` when the Endpoint accepts none. */
export type InputSnapshot = {
  readonly params: ObjectNode | null;
  readonly query: ObjectNode | null;
  readonly headers: ObjectNode | null;
  readonly body: SchemaNode | null;
};

/** What an Endpoint answers when it does what was asked. */
export type SuccessSnapshot = {
  readonly status: number;
  readonly headers: ObjectNode | null;
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
  readonly demands: { readonly headers: ObjectNode | null; readonly query: ObjectNode | null };
  readonly context: SchemaNode | null;
  readonly rejections: readonly string[];
};

/** A code with its one status and body shape and its first declaration's message. */
export type CodeSnapshot = {
  readonly origin: Origin;
  readonly status: number;
  readonly message: string;
  readonly body: SchemaNode | null;
  readonly removed: boolean;
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

/** What a Contract uses of one Provider: the version it relied on and the Endpoints it selects. */
export type DependencySnapshot = {
  readonly against: string;
  readonly endpoints: readonly { readonly id: string; readonly name: string }[];
};

/** What every Snapshot starts with; `version` is left to `publish`. */
type Heading<Kind extends string> = {
  readonly format: SnapshotFormat;
  readonly kind: Kind;
  readonly name: string;
  readonly generator: string;
};

/** A map of a Snapshot, keyed by identity or name. */
export type ByKey<Value> = Readonly<Record<string, Value>>;

/** The declared Snapshot of a Service's Contract. */
export type ServiceSnapshot = Heading<'service'> & {
  readonly standardRejections: StandardRejectionsSnapshot;
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

/** The declared Snapshot of a Definitions Package: everything it declares, reached or not. */
export type DefinitionsSnapshot = Heading<'definitions'> & {
  readonly standardRejections: StandardRejectionsSnapshot;
  readonly defs: ByKey<SchemaNode>;
  readonly exports: ByKey<ExportSnapshot>;
  readonly guards: ByKey<GuardSnapshot>;
  readonly codes: ByKey<CodeSnapshot>;
};

/** A declared Snapshot, as `generate` writes it to `contract.snapshot.json`. */
export type Snapshot = ServiceSnapshot | ApplicationSnapshot | DefinitionsSnapshot;

/**
 * The Snapshot a Contract Package exports beside its `contract`: its exported Endpoints and Events
 * that are not Retired, with the Guards, codes and defs they reach, keyed as in the Snapshot, so a
 * Consumer reads their nodes and no Private Element reaches a browser.
 */
export type ExportedSnapshot = Pick<
  ServiceSnapshot,
  'format' | 'defs' | 'endpoints' | 'events' | 'guards' | 'codes'
>;
