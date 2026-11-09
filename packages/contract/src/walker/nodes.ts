import type { StringFormat } from './format-schemas.ts';
import type { Place } from './location.ts';

/** Where a schema sits in the Snapshot, so a failure points at what the author wrote. */
export type Path = readonly (string | number)[];

/** Where a schema was declared: `"local"`, or a Definitions Package and version with `#name`. */
export type Origin = string;

/** The annotations that are Neutral: they change nothing a Consumer relies on, so no shape compares them. */
export const neutralAnnotations = ['description', 'examples', 'origin'] as const;

/** What every node may carry besides its shape; `description`, `examples` and `origin` are Neutral. */
export type Annotations = {
  readonly nullable?: true;
  readonly description?: string;
  readonly examples?: readonly unknown[];
  readonly origin?: Origin;
};

/** A regex as `RegExp.prototype.source` and `flags` give it, so two compare equal only if identical. */
export type Regex = { readonly source: string; readonly flags: string };

/** A value an enum can hold, kept with its JSON type: `true` is not `"true"`. */
export type JsonPrimitive = string | number | boolean;

/** A string, with a known format, a regex and length bounds when declared. */
export type StringNode = Annotations & {
  readonly type: 'string';
  readonly format?: StringFormat;
  readonly formatOptions?: Readonly<Record<string, unknown>>;
  readonly regex?: Regex;
  readonly min?: number;
  readonly max?: number;
};

/** A number, with the bounds and steps declared; `int` is a safe integer, which the node writes no bounds for. */
export type NumberNode = Annotations & {
  readonly type: 'number';
  readonly int?: true;
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: number;
  readonly exclusiveMax?: number;
  readonly multipleOf?: number;
};

/** A boolean. */
export type BooleanNode = Annotations & { readonly type: 'boolean' };

/** One of several values; an open one's readers handle values they do not know. */
export type EnumNode = Annotations & {
  readonly type: 'enum';
  readonly values: readonly JsonPrimitive[];
  readonly open: boolean;
};

/** A field of an object: whether it must be present is apart from whether it may be null. */
export interface FieldOf<Child> {
  readonly required: boolean;
  readonly schema: Child;
}

/**
 * An object with named fields; always open, since a Contract declares no strict object. Generic
 * over what its children are, so the same shape describes a node and the outline of a failed walk.
 */
export interface ObjectNodeOf<Child> extends Annotations {
  readonly type: 'object';
  readonly fields: Readonly<Record<string, FieldOf<Child>>>;
}

/** An object whose keys are dynamic strings, all with one value schema. */
export interface RecordNodeOf<Child> extends Annotations {
  readonly type: 'record';
  readonly key: StringNode;
  readonly value: Child;
}

/** A list of items of one schema. */
export interface ArrayNodeOf<Child> extends Annotations {
  readonly type: 'array';
  readonly items: Child;
  readonly min?: number;
  readonly max?: number;
}

/** A list whose positions have their own schemas, then any number of `rest`. */
export interface TupleNodeOf<Child> extends Annotations {
  readonly type: 'tuple';
  readonly items: readonly Child[];
  readonly rest?: Child;
}

/** A value that matches at least one of the options. */
export interface UnionNodeOf<Child> extends Annotations {
  readonly type: 'union';
  readonly options: readonly Child[];
}

/**
 * Objects told apart by one field, keyed by the canonical JSON of its value in each variant; a
 * variant may be a `ref` to an object def.
 */
export interface TaggedNodeOf<Variant> extends Annotations {
  readonly type: 'tagged';
  readonly discriminator: string;
  readonly variants: Readonly<Record<string, Variant>>;
}

/** A value that matches every item, for an intersection that is not of open objects. */
export interface AllOfNodeOf<Child> extends Annotations {
  readonly type: 'allOf';
  readonly items: readonly Child[];
}

/** A field of an object as the Snapshot describes it. */
export type Field = FieldOf<SchemaNode>;

/** An object as the Snapshot describes it. */
export type ObjectNode = ObjectNodeOf<SchemaNode>;

/** A record as the Snapshot describes it. */
export type RecordNode = RecordNodeOf<SchemaNode>;

/** An array as the Snapshot describes it. */
export type ArrayNode = ArrayNodeOf<SchemaNode>;

/** A tuple as the Snapshot describes it. */
export type TupleNode = TupleNodeOf<SchemaNode>;

/** A union as the Snapshot describes it. */
export type UnionNode = UnionNodeOf<SchemaNode>;

/** A tagged union as the Snapshot describes it. */
export type TaggedNode = TaggedNodeOf<ObjectNode | RefNode>;

/** An intersection that is not of open objects, as the Snapshot describes it. */
export type AllOfNode = AllOfNodeOf<SchemaNode>;

/** Any JSON value. */
export type JsonNode = Annotations & { readonly type: 'json' };

/** A schema with an id on a cycle, written once under the Snapshot's `defs` by that id. */
export type RefNode = Annotations & { readonly type: 'ref'; readonly name: string };

/** The name of the def a `ref` node carries, or none for any other node. */
export function refNameOf(node: SchemaNode): string | undefined {
  return node.type === 'ref' ? node.name : undefined;
}

/** A schema as the Snapshot describes it, language-neutral, for the Compatibility Check. */
export type SchemaNode =
  | StringNode
  | NumberNode
  | BooleanNode
  | EnumNode
  | ObjectNode
  | RecordNode
  | ArrayNode
  | TupleNode
  | UnionNode
  | TaggedNode
  | AllOfNode
  | JsonNode
  | RefNode;

/**
 * A zod construct no node or check maps, where it was written, and what to use instead, with the
 * schema it sits in (the value itself, for one that is no zod 4 schema), so a construct reached
 * from many places is told once, and the origin of the Definitions Package that declares that
 * schema, or the nearest one around it.
 */
export type NotAllowed = Place & {
  readonly kind: 'not-allowed';
  readonly construct: string;
  readonly instead?: string;
  readonly schema: unknown;
  readonly origin: Origin | undefined;
};
