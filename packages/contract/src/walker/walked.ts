import type * as core from 'zod/v4/core';
import type { Place } from './location.ts';
import type {
  AllOfNodeOf,
  Annotations,
  ArrayNodeOf,
  BooleanNode,
  EnumNode,
  Field,
  FieldOf,
  JsonNode,
  NotAllowed,
  NumberNode,
  ObjectNodeOf,
  Origin,
  RecordNodeOf,
  RefNode,
  SchemaNode,
  StringNode,
  TaggedNodeOf,
  TupleNodeOf,
  UnionNodeOf,
} from './nodes.ts';

/** A schema of a Snapshot, and where it sits in it. */
export type LocatedSchema = { readonly at: Place; readonly schema: core.$ZodType };

/**
 * The refusals of a failed walk, held as the trees of what it holds: a failing schema used many
 * times is held, never copied, so a walk's failures cost what its schemas do.
 */
export type FailureTree = readonly (NotAllowed | FailureTree)[];

/** The mark `failed` sets on an outline, so a node walked whole tells itself from one that was not. */
type Failing = { readonly failing?: true };

/**
 * A refused construct where it stands, or a node whose kind one decides: no rule reads its kind,
 * values or contents, so a line told beside it holds whatever allowed schema replaces it.
 */
export interface Unbuilt extends Annotations, Failing {
  readonly type?: undefined;
}

/** An object as a failed walk kept it: each field's outline. */
export type ObjectOutline = ObjectNodeOf<Outline> & Failing;

/** A record as a failed walk kept it: a string key and the outline of its value. */
export type RecordOutline = RecordNodeOf<Outline> & Failing;

/** An array as a failed walk kept it. */
export type ArrayOutline = ArrayNodeOf<Outline> & Failing;

/** A tuple as a failed walk kept it. */
export type TupleOutline = TupleNodeOf<Outline> & Failing;

/** A union as a failed walk kept it. */
export type UnionOutline = UnionNodeOf<Outline> & Failing;

/** A discriminated union as a failed walk kept it: the variants that have a key. */
export type TaggedOutline = TaggedNodeOf<Outline> & Failing;

/** An intersection as a failed walk kept it. */
export type AllOfOutline = AllOfNodeOf<Outline> & Failing;

/**
 * The node a failed walk was building, as far as it got, all the way down, so every rule judges
 * what the author wrote around a refused construct. A construct refused at its own schema leaves
 * `Unbuilt` there, and so does a node whose kind an `Unbuilt` part could change. A node walked
 * whole is its own outline.
 */
export type Outline =
  | (StringNode & Failing)
  | (NumberNode & Failing)
  | (BooleanNode & Failing)
  | (EnumNode & Failing)
  | (JsonNode & Failing)
  | (RefNode & Failing)
  | ObjectOutline
  | RecordOutline
  | ArrayOutline
  | TupleOutline
  | UnionOutline
  | TaggedOutline
  | AllOfOutline
  | Unbuilt;

/**
 * The defs a walk judged, by their id: every def it wrote or was writing when it failed, each as
 * the outline it was built as, so the rules over defs judge a def that fails too.
 */
export type JudgedDefs = Readonly<Record<string, Outline>>;

/** An outline of nothing the walk built: where a refused construct stands. */
export const unbuilt: Unbuilt = {};

/** Whether an outline is a node walked whole, which every rule, parse and Snapshot may take as a node. */
export function isWhole(outline: Outline | undefined): outline is SchemaNode {
  return outline !== undefined && outline.type !== undefined && outline.failing !== true;
}

/** A failed walk: the tree of every construct in it that is not allowed, and what it was building. */
export type Failed<Kept = Outline> = {
  readonly kind: 'not-allowed';
  readonly tree: FailureTree;
  readonly outline?: Kept;
};

/** A schema walked to its value. */
export type WalkedValue<Value> = { readonly kind: 'walked'; readonly value: Value };

/** One schema walked: its value, or every construct in it that is not allowed. */
export type Walked<Value = SchemaNode, Kept = Outline> = WalkedValue<Value> | Failed<Kept>;

/**
 * Where the walk is: a place, the value being walked there, a schema unless it is the refusal of a
 * value that is none, and the nearest origin of a Definitions Package around it, which a refusal
 * there tells.
 */
export type Reached = Place & {
  readonly schema: unknown;
  readonly origin: Origin | undefined;
};

/** A place under a schema being walked, which passes its origin down to the schema entered there. */
export type Under = Place & { readonly origin?: Origin | undefined };

/** A schema the walk entered and the place it entered it at. */
export type ReachedSchema = { readonly at: Reached; readonly schema: core.$ZodType };

/** A value a schema holds where zod types a schema, which the walk judges when it enters it. */
export type ReachedChild = { readonly at: Reached; readonly schema: unknown };

/**
 * An `allOf` or a `union` node a walk built or was building, and the refusal it is where it was
 * built if the defs, once known, show it reaches an Open Enum.
 */
export type Composition = {
  readonly refusal: NotAllowed;
  readonly node: AllOfNodeOf<Outline> | UnionNodeOf<Outline>;
};

/** One place a schema the walk remembers is entered, inside the walk of another remembered schema or of none. */
export type Reach = { readonly at: Reached; within: Memo | undefined };

/**
 * A schema the walk entered once and answers from memory after: a def, a schema with an id that
 * failed or a member of a cycle no id names. Where the walk entered it, and every place it is
 * reached, that first place included; what was raised inside it sits under that first place.
 */
export type Memo = { readonly at: Reached; readonly reaches: Reach[] };

/** A schema the walk enters, and where: the driver walks it as a frame of its own. */
export type Visit = { readonly schema: unknown; readonly at: Under };

/**
 * A walk in progress: it yields each schema it enters for the driver to walk, receives that
 * schema's result back, and returns its own, so no depth of schemas grows the call stack.
 */
export type Walking<Value = SchemaNode, Kept = Outline> = Generator<
  Visit,
  Walked<Value, Kept>,
  Walked
>;

/**
 * How a schema's walk enters what it holds. Every schema entered is yielded to the driver as a
 * `Visit`; a walk never delegates into another schema's walk, which would grow the call stack.
 */
export type Walker = {
  readonly schema: (schema: unknown, at: Under) => Walking;
  readonly field: (schema: unknown, at: Under) => Walking<Field, FieldOf<Outline>>;
  /** The place a schema is entered at, which a refusal raised at the schema tells. */
  readonly reach: (schema: unknown, at: Under) => Reached;
};

/** A walked value, as the walk of a schema returns it. */
export function walked<Value>(value: Value): WalkedValue<Value> {
  return { kind: 'walked', value };
}

/** Every value when each walked, else every failure of all of them, so none hides another. */
export function allWalked<Value>(
  list: readonly Walked<Value, unknown>[],
): Walked<readonly Value[]> {
  if (list.some(isNotAllowed)) {
    return failed(failuresOf(list));
  }
  return walked(list.filter(isWalked).map((success) => success.value));
}

/**
 * A failed walk, from refusals or failure trees a caller already knows are there: an empty tree is
 * a bug. The outline is kept on a copy marked as one of a failed walk, so no node another outline
 * or a memo shares is marked.
 */
export function failed(tree: FailureTree, outline?: Outline): Failed {
  if (tree.length === 0) {
    throw new Error('A failed walk must name the construct that is not allowed.');
  }
  return { kind: 'not-allowed', tree, ...(outline && { outline: { ...outline, failing: true } }) };
}

/** A failed field walk, with the field it was building. */
export function failedField(tree: FailureTree, field: FieldOf<Outline>): Failed<FieldOf<Outline>> {
  return { kind: 'not-allowed', tree, outline: field };
}

/**
 * Every refusal in the tree, each once, in the order a walk first meets it: a refusal or subtree
 * already in `seen` is skipped whole, and each one met joins it, so a walk-wide `seen` takes each once.
 */
export function refusalsIn(
  tree: FailureTree,
  seen: Set<NotAllowed | FailureTree> = new Set(),
): readonly NotAllowed[] {
  const refusals: NotAllowed[] = [];
  const pending: (NotAllowed | FailureTree)[] = [tree];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    if (!isFailureTree(item)) {
      refusals.push(item);
      continue;
    }
    for (const part of item.toReversed()) {
      pending.push(part);
    }
  }
  return refusals;
}

/** Whether a part of a failure tree is a subtree and not a refusal. */
export function isFailureTree(part: NotAllowed | FailureTree): part is FailureTree {
  return Array.isArray(part);
}

/** A refused call on a schema reported beside the walk of the schema, which keeps its node. */
export function refusedBeside(refusal: Failed, inner: Walked): Failed {
  return failed(failuresOf([refusal, inner]), outlineOf(inner));
}

/** The node a walk built, or the one it was building when it failed: `Unbuilt` for a refused construct. */
export function outlineOf(walkedSchema: Walked): Outline {
  return walkedSchema.kind === 'walked' ? walkedSchema.value : (walkedSchema.outline ?? unbuilt);
}

/** The failure trees of the failed ones among walked values, in order. */
export function failuresOf(list: readonly Walked<unknown, unknown>[]): FailureTree {
  return list.filter(isNotAllowed).map((failure) => failure.tree);
}

function isWalked<Value>(result: Walked<Value, unknown>): result is WalkedValue<Value> {
  return result.kind === 'walked';
}

function isNotAllowed(result: Walked<unknown, unknown>): result is Failed<unknown> {
  return result.kind === 'not-allowed';
}
