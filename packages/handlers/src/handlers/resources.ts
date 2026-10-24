/** The Resources of a Handler that takes none: an empty object type, which a union of Resources never absorbs as it would `unknown`. */
export type NoResources = Readonly<Record<never, never>>;

/** What a Handler takes beside what it is given: the Service's Resources, which `serve` and `consume` hand it unread. */
export type WithResources<Resources extends object> = { readonly resources: Resources };

/** `resources`, required exactly when some Handler takes one. */
export type ResourcesField<Resources extends object> = keyof Resources extends never
  ? { readonly resources?: Resources }
  : { readonly resources: Resources };

/** A last argument that may be left out when every field it holds is optional. */
export type CallArgument<Call> = Partial<Call> extends Call ? [call?: Call] : [call: Call];
