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

type UnionToIntersection<Union> = (
  Union extends unknown
    ? (member: Union) => void
    : never
) extends (member: infer Intersection) => void
  ? Intersection
  : never;

type CallOf<Handler> = Handler extends (first: never, second: never, ...call: infer Call) => unknown
  ? Call[0]
  : never;

/** The Resources one Handler takes, none for a Handler that takes none; distributes, so a Handler that takes none never narrows the others. */
type ResourcesOfHandler<Handler> = Handler extends unknown
  ? NonNullable<CallOf<Handler>> extends { readonly resources?: infer Resources }
    ? keyof NonNullable<Resources> extends never
      ? never
      : NonNullable<Resources>
    : never
  : never;

type HandlersIn<Handlers> = {
  [Map in keyof Handlers]: Handlers[Map][keyof Handlers[Map]];
}[keyof Handlers];

type Flattened<Intersection> = [unknown] extends [Intersection]
  ? NoResources
  : { [Key in keyof Intersection]: Intersection[Key] };

/** The Resources the Handlers of a map take together, which `serve` and `consume` hand them: every one any of its Handlers takes. */
export type ResourcesOf<Handlers extends object> = Flattened<
  UnionToIntersection<ResourcesOfHandler<HandlersIn<Handlers>>>
>;
