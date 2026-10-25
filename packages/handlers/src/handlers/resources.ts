/** The Resources of a Handler that takes none: an empty object type, which a union of Resources never absorbs as it would `unknown`. */
export type NoResources = Readonly<Record<never, never>>;

declare const unannotated: unique symbol;

/**
 * The Resources of an implementation whose last parameter is not annotated: named so a type error
 * says to annotate it, as `Needs<…>` does; it takes none.
 */
export type ResourcesNotAnnotated = {
  readonly [unannotated]?: 'annotate the last parameter, as Needs<…> does';
};

/** The keys of Resources a Handler takes: any but the one `ResourcesNotAnnotated` names itself by. */
type TakenKeyOf<Resources> = Exclude<keyof Resources, typeof unannotated>;

/**
 * The Resources a Handler returned by `handle()` takes: none when its implementation's last
 * parameter is not annotated, so a direct call or a map may still hand it any; `any` stays `any`,
 * for `ResourcesOf` to refuse.
 */
export type HandledResourcesOf<Resources extends object> = 0 extends 1 & Resources
  ? Resources
  : [ResourcesNotAnnotated] extends [Resources]
    ? NoResources
    : Resources;

/** What a Handler takes beside what it is given: the Service's Resources, which `serve` and `consume` hand it unread. */
export type WithResources<Resources extends object> = { readonly resources: Resources };

/** `resources`, required exactly when some Handler takes one. */
export type ResourcesField<Resources extends object> =
  TakenKeyOf<Resources> extends never
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

/** What a map's Resources hold when a Handler types its own as `any`, which would erase every other: the cause, by name. */
type AnyResourcesRefusal = {
  readonly 'A Handler types its Resources as any: type them, as Needs<…> does': never;
};

/** The Resources one Handler takes, none for a Handler that takes none; distributes, so a Handler that takes none never narrows the others. */
type ResourcesOfHandler<Handler> = Handler extends unknown
  ? NonNullable<CallOf<Handler>> extends { readonly resources?: infer Resources }
    ? TakenResourcesOf<NonNullable<Resources>>
    : never
  : never;

/** The Resources a Handler's last argument holds, none when it takes none, the refusal when `any`. */
type TakenResourcesOf<Resources> = 0 extends 1 & Resources
  ? AnyResourcesRefusal
  : TakenKeyOf<Resources> extends never
    ? never
    : Resources;

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
