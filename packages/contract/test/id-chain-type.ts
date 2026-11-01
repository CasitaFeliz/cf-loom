import type { z } from 'zod';
import type { SchemaNode } from '../src/internal/index.ts';

/** A step of a holding: the type of a node it passes through, with `nullable` when that node admits null. */
type Step<Type extends SchemaNode['type']> =
  | Type
  | { readonly type: Type; readonly nullable: true };

/**
 * One way a link holds the one before it, as the steps from the link's def down to the `ref` to the
 * link before: `['object', 'record', 'ref']` is a record in a field of an object.
 */
export type Holding = readonly [...(readonly Step<SchemaNode['type']>[]), Step<'ref'>];

/** What every chain says of how its links hold the one before. */
type ChainBase = {
  /** The chain's name within its node type, kebab-case, which its test file carries: `item-and-field`. */
  readonly name: string;
  /** Every way a link holds the one before it, each once; the declared Snapshot has these and no other. */
  readonly holdings: readonly [Holding, ...Holding[]];
};

/** A chain whose links each lie on a cycle of their own: `self` is the link being made, which it holds back. */
type OwnCycleChain = ChainBase & {
  readonly cycle: 'own';
  readonly linkOf: (previous: z.ZodType, self: () => z.ZodType) => z.ZodType;
  /** The link the chain starts from, when not `z.object({ leaf: z.string() })`. */
  readonly startOf?: () => z.ZodType;
};

/** A chain whose links all lie on one cycle, through the first, which holds the last. */
type GroupCycleChain = ChainBase & {
  readonly cycle: 'group';
  readonly linkOf: (previous: z.ZodType) => z.ZodType;
};

/** A chain of recursion ids, each holding the one before it through one way of holding. */
export type IdChain = OwnCycleChain | GroupCycleChain;

type Annotation = 'type' | 'nullable' | 'description' | 'examples' | 'origin';

/** Whether a value of type `Value` can hold a schema: a node, a list or record of them, or a field. */
type HoldsNode<Value> = [Value] extends [SchemaNode]
  ? true
  : Value extends readonly (infer Item)[]
    ? HoldsNode<Item>
    : Value extends { readonly schema: infer Schema }
      ? HoldsNode<Schema>
      : Value extends Readonly<Record<string, infer Member>>
        ? [Member] extends [SchemaNode]
          ? true
          : Member extends { readonly schema: infer Schema }
            ? HoldsNode<Schema>
            : false
        : false;

/** Whether a node holds a schema: a property typed as one, or a list or record of them; `ref` holds the def it names. */
type HoldsSchema<Node> = Node extends { readonly type: 'ref' }
  ? true
  : true extends {
        [Key in Exclude<keyof Node, Annotation>]-?: HoldsNode<NonNullable<Node[Key]>>;
      }[Exclude<keyof Node, Annotation>]
    ? true
    : false;

/**
 * A node type's chains: at least one when its node holds a schema (a property typed SchemaNode or
 * Field, or a list or record of them; `ref` holds the def it names), none for a leaf.
 */
export type ChainsOf<Type extends SchemaNode['type']> =
  HoldsSchema<Extract<SchemaNode, { readonly type: Type }>> extends true
    ? readonly [IdChain, ...IdChain[]]
    : readonly [];

/** Every node type with its chains: at least one for a type that holds a schema, none for a leaf. */
export type ChainTable = { readonly [Type in SchemaNode['type']]: ChainsOf<Type> };
