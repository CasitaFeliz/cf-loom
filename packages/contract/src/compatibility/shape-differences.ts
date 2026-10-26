import type { JsonPrimitive, SchemaNode } from '../walker/index.ts';

/** A type whose values an enum can all share: a string, a number or a boolean. */
export type BaseType = 'string' | 'number' | 'boolean';

/**
 * A constraint compared on its own: a lower or an upper bound (a number's value, a string's
 * length or an array's item count; inclusive or exclusive), `int`, `multipleOf`, `format` with
 * its options, or `regex`.
 */
export type Constraint = 'lower-bound' | 'upper-bound' | 'int' | 'multipleOf' | 'format' | 'regex';

/** What differs in a schema at one path: its shape, or a Neutral annotation. */
export type ShapeDifference =
  | { readonly kind: 'field-added'; readonly required: boolean }
  | { readonly kind: 'field-removed' }
  | { readonly kind: 'field-made-required' }
  | { readonly kind: 'field-made-optional' }
  | { readonly kind: 'nullability-added' }
  | { readonly kind: 'nullability-removed' }
  /** A value added to an enum, with the Baseline's openness, which its deployed readers hold. */
  | {
      readonly kind: 'value-added';
      readonly value: JsonPrimitive;
      readonly enum: 'open' | 'closed';
    }
  | { readonly kind: 'value-removed'; readonly value: JsonPrimitive }
  | { readonly kind: 'enum-opened' }
  | { readonly kind: 'enum-closed' }
  /** An enum widened to the base type every value shares, with no constraint. */
  | { readonly kind: 'enum-widened'; readonly to: BaseType }
  /** An unconstrained base type narrowed to an enum of its values. */
  | { readonly kind: 'enum-narrowed'; readonly from: BaseType }
  | { readonly kind: 'variant-added' }
  | { readonly kind: 'variant-removed' }
  | { readonly kind: 'discriminator-changed'; readonly from: string; readonly to: string }
  | { readonly kind: 'union-changed' }
  | {
      readonly kind: 'type-changed';
      readonly from: SchemaNode['type'];
      readonly to: SchemaNode['type'];
    }
  /** A constraint added, or changed to admit fewer values, such as `min: 5` to `exclusiveMin: 5`. */
  | { readonly kind: 'constraint-tightened'; readonly constraint: Constraint }
  /** A constraint removed, or changed to admit more values. */
  | { readonly kind: 'constraint-relaxed'; readonly constraint: Constraint }
  /** A format, its options, a regex or a `multipleOf` changed to one neither tighter nor looser. */
  | {
      readonly kind: 'constraint-replaced';
      readonly constraint: 'format' | 'regex' | 'multipleOf';
    }
  /** A tuple that now takes further items after its own. */
  | { readonly kind: 'rest-added' }
  /** A tuple that no longer takes further items after its own. */
  | { readonly kind: 'rest-removed' }
  /**
   * A change no rule proves compatible, so Breaking in every Position: a tuple's items or an
   * intersection that is not of objects, under the plain-union rule, or a path param that either
   * Snapshot holds no schema for.
   */
  | { readonly kind: 'unproven'; readonly node: 'tuple' | 'allOf' | 'param' }
  /** A node's description, examples or origin changed, or a `ref` names a def of another name. */
  | {
      readonly kind: 'annotation-changed';
      readonly annotation: 'description' | 'examples' | 'origin' | 'id';
    };
