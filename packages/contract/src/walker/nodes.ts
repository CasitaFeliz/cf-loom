import type { StringFormat } from './string-formats.ts';

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

/** A number, with the bounds and steps declared; `int` implies no safe-integer bounds. */
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
export type Field = { readonly required: boolean; readonly schema: SchemaNode };

/** An object with named fields; a `strict` one takes no other keys. */
export type ObjectNode = Annotations & {
  readonly type: 'object';
  readonly mode: 'open' | 'strict';
  readonly fields: Readonly<Record<string, Field>>;
};

/** An object whose keys are dynamic strings, all with one value schema. */
export type RecordNode = Annotations & {
  readonly type: 'record';
  readonly key: SchemaNode;
  readonly value: SchemaNode;
};

/** A list of items of one schema. */
export type ArrayNode = Annotations & {
  readonly type: 'array';
  readonly items: SchemaNode;
  readonly min?: number;
  readonly max?: number;
};

/** A list whose positions have their own schemas, then any number of `rest`. */
export type TupleNode = Annotations & {
  readonly type: 'tuple';
  readonly items: readonly SchemaNode[];
  readonly rest?: SchemaNode;
};

/** A value that matches at least one of the options. */
export type UnionNode = Annotations & {
  readonly type: 'union';
  readonly options: readonly SchemaNode[];
};

/**
 * Objects told apart by one field, keyed by the canonical JSON of its value in each variant; a
 * variant may be a `ref` to an object def.
 */
export type TaggedNode = Annotations & {
  readonly type: 'tagged';
  readonly discriminator: string;
  readonly variants: Readonly<Record<string, ObjectNode | RefNode>>;
};

/** A value that matches every item, for an intersection that is not of open objects. */
export type AllOfNode = Annotations & {
  readonly type: 'allOf';
  readonly items: readonly SchemaNode[];
};

/** Any JSON value. */
export type JsonNode = Annotations & { readonly type: 'json' };

/** A schema with an id on a cycle, written once under the Snapshot's `defs` by that id. */
export type RefNode = Annotations & { readonly type: 'ref'; readonly name: string };

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

/** A zod construct no node or check maps, where it was written, and what to use instead. */
export type NotAllowed = {
  readonly kind: 'not-allowed';
  readonly at: Path;
  readonly construct: string;
  readonly instead?: string;
};
