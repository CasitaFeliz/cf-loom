import type { Visibility } from '../declarations/index.ts';
import type { JsonPrimitive, ObjectNode, Path, SchemaNode } from '../walker/index.ts';

/**
 * Where a Change is: an Element by identity, with its Visibility, which decides the bump, or a
 * Definitions Package's shared schema by name. When the Visibility moved, it is the wider of the
 * two; when the Element is on one side only, that side's.
 */
export type ChangeSite =
  | { readonly kind: 'endpoint'; readonly identity: string; readonly visibility: Visibility }
  | { readonly kind: 'event'; readonly identity: string; readonly visibility: Visibility }
  | { readonly kind: 'command'; readonly identity: string }
  /** A Definitions Package's shared schema by name: it has no Position until an Element uses it. */
  | { readonly kind: 'shared-schema'; readonly name: string };

/** A Dependency the dependency graph holds on an Element: the Contract Package that declares it, at a version. */
export type GraphDependency = { readonly name: string; readonly version: string };

/**
 * Where a shape is read, which decides what makes a change to it Breaking: Input, Success (a
 * Rejection's body included) or Message.
 */
export type Position = 'input' | 'success' | 'message';

/** Where a schema is judged: in one Position, or in all three as `every`, for a shared schema. */
export type PositionOrEvery = Position | 'every';

/** A type whose values an enum can all share: a string, a number or a boolean. */
export type BaseType = 'string' | 'number' | 'boolean';

/**
 * A constraint compared on its own: a lower or an upper bound (a number's value, a string's
 * length or an array's item count; inclusive or exclusive), `int`, `multipleOf`, `format` with
 * its options, or `regex`.
 */
export type Constraint = 'lower-bound' | 'upper-bound' | 'int' | 'multipleOf' | 'format' | 'regex';

/** What differs in a schema's shape at one path; a Neutral annotation never does. */
export type ShapeDifference =
  | { readonly kind: 'field-added'; readonly required: boolean }
  | { readonly kind: 'field-removed' }
  /** A key gone from a record keyed by an enum or literal, which refuses it from then on. */
  | { readonly kind: 'key-removed' }
  | { readonly kind: 'field-made-required' }
  | { readonly kind: 'field-made-optional' }
  | { readonly kind: 'nullability-added' }
  | { readonly kind: 'nullability-removed' }
  /** A value added to an enum or literal, with the Baseline's openness, which its deployed readers hold. */
  | {
      readonly kind: 'value-added';
      readonly value: JsonPrimitive;
      readonly enum: 'open' | 'closed';
    }
  | { readonly kind: 'value-removed'; readonly value: JsonPrimitive }
  | { readonly kind: 'enum-opened' }
  | { readonly kind: 'enum-closed' }
  /** An enum or literal widened to the base type every value shares, with no constraint. */
  | { readonly kind: 'enum-widened'; readonly to: BaseType }
  /** An unconstrained base type narrowed to an enum or literal of its values. */
  | { readonly kind: 'enum-narrowed'; readonly from: BaseType }
  | { readonly kind: 'variant-added' }
  | { readonly kind: 'variant-removed' }
  | { readonly kind: 'discriminator-changed'; readonly from: string; readonly to: string }
  | { readonly kind: 'union-changed' }
  | {
      readonly kind: 'mode-changed';
      readonly from: ObjectNode['mode'];
      readonly to: ObjectNode['mode'];
    }
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
   * intersection that is not of objects, under the plain-union rule, or a `ref` that resolves to
   * no schema.
   */
  | { readonly kind: 'unproven'; readonly node: 'tuple' | 'allOf' | 'ref' };

/** What differs between the Baseline and the proposed Snapshot at one site. */
export type Difference =
  | { readonly kind: 'added' }
  | { readonly kind: 'deprecated' }
  | { readonly kind: 'reactivated' }
  | { readonly kind: 'retired'; readonly dependencies: readonly GraphDependency[] }
  | { readonly kind: 'retired-before-deprecated' }
  | { readonly kind: 'retired-brought-back'; readonly lifecycle: 'active' | 'deprecated' }
  | { readonly kind: 'tombstoned' }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'identity-reused' }
  | {
      readonly kind: 'renamed';
      readonly from: string;
      readonly to: string;
      readonly visibility: Visibility;
      readonly dependencies: readonly GraphDependency[];
    }
  | { readonly kind: 'visibility-widened'; readonly from: Visibility; readonly to: Visibility }
  | { readonly kind: 'visibility-narrowed'; readonly from: Visibility; readonly to: Visibility }
  /**
   * A difference inside a schema, at its path from the site, read in one Position, or in `every`
   * for a shared schema, which takes the strongest class of the three.
   */
  | {
      readonly kind: 'schema';
      readonly at: Path;
      readonly position: PositionOrEvery;
      readonly shape: ShapeDifference;
    }
  /** A shared schema gone from its Definitions Package. */
  | { readonly kind: 'removed' };

/** A difference's class; only a Breaking Change says whether it needs a Breaking Change Approval. */
export type Classification =
  | { readonly class: 'additive' | 'neutral' | 'not-allowed' }
  | { readonly class: 'breaking'; readonly approval: 'needed' | 'not-needed' };

/** How the Compatibility Check judges a difference: its class, or Not allowed, which fails the check. */
export type ChangeClass = Classification['class'];

/** One difference the Compatibility Check found, with its class. */
export type Change = {
  readonly site: ChangeSite;
  readonly difference: Difference;
} & Classification;

/** A Compatibility Check that compared, with its Changes in order and whether the Snapshot's hash moved. */
export type ComparedReport = {
  readonly kind: 'compared';
  readonly changes: readonly Change[];
  readonly hashChanged: boolean;
};

/** What the Compatibility Check found: nothing to compare without a Baseline, or every Change against it. */
export type CompatibilityReport = { readonly kind: 'no-baseline' } | ComparedReport;
