import type { z } from 'zod';
import type { SchemaNode } from '../src/internal/index.ts';

/** A chain of recursion ids, each holding the one before it through one way of holding. */
export type IdChain = {
  /** The chain's name within its node type, kebab-case, which its test file carries: `item-and-field`. */
  readonly name: string;
  /** The way of holding, in words: "a union's option, and a field". */
  readonly holder: string;
  /** The schema of a link, holding `previous`; `self` is the link being made, for a cycle of its own. */
  readonly linkOf: (previous: z.ZodType, self: () => z.ZodType) => z.ZodType;
  /** Each link on a cycle of its own, or all on one cycle through the first. */
  readonly cycle: 'own' | 'group';
  /** The link the chain starts from, when not `z.object({ leaf: z.string() })`. */
  readonly startOf?: () => z.ZodType;
};

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
