import type { Visibility } from '../declarations/index.ts';
import type { JsonPrimitive, SchemaNode } from '../walker/index.ts';
import type { Step } from './steps.ts';

/**
 * Where a Change is, with the Visibility that decides its bump: the wider of the Baseline's and
 * the proposed one when it moved, else the side the Element is on.
 */
export type ChangeSite =
  /** An Endpoint by identity, with its name: the proposed one, or the Baseline's when it is dropped. */
  | {
      readonly kind: 'endpoint';
      readonly identity: string;
      readonly name: string;
      readonly visibility: Visibility;
    }
  /** An Event or a Command by identity; a Command is always Private. */
  | {
      readonly kind: 'event' | 'command';
      readonly identity: string;
      readonly visibility: Visibility;
    }
  /**
   * A Rejection code, which is no Element: its Visibility is the widest of the Endpoints that answer
   * it before or after the change, or Private when none does, or Public in a Definitions Package.
   */
  | { readonly kind: 'code'; readonly code: string; readonly visibility: Visibility }
  /**
   * A Subscription by name, Private since no Consumer relies on what a Service itself consumes; or
   * a Definitions Package's export or Guard by name, Public since the Services that import it may
   * use all of it.
   */
  | {
      readonly kind: 'subscription' | 'export' | 'guard';
      readonly name: string;
      readonly visibility: Visibility;
    };

/**
 * Where a shape is read, which decides what makes a change to it Breaking: Input, Success (a
 * Rejection's body included) or Message.
 */
export type Position = 'input' | 'success' | 'message';

/** Where an Endpoint's part is read: as Input by the Service, or as Success by a Caller. */
export type EndpointPosition = Exclude<Position, 'message'>;

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
  | { readonly kind: 'unproven'; readonly node: 'tuple' | 'allOf' | 'param' };

/** What differs between the Baseline and the proposed Snapshot at one site. */
export type Difference =
  | { readonly kind: 'added' }
  | { readonly kind: 'deprecated' }
  | { readonly kind: 'reactivated' }
  /** An Element Retired that the Baseline holds Deprecated. */
  | { readonly kind: 'retired' }
  | { readonly kind: 'retired-before-deprecated' }
  | { readonly kind: 'retired-brought-back'; readonly lifecycle: 'active' | 'deprecated' }
  | { readonly kind: 'tombstoned' }
  | { readonly kind: 'deleted' }
  /** An identity declared where the Baseline holds a tombstone: a Retired Element's, or a removed Subscription's name. */
  | { readonly kind: 'identity-reused' }
  /** A Message Version added whose previous version, by identity, neither the Baseline nor the proposed Snapshot holds. */
  | { readonly kind: 'version-gap'; readonly missing: string }
  /** A Message Version added under a name the Baseline holds as the other kind, a tombstone included: a name keeps one kind. */
  | { readonly kind: 'name-kind-changed'; readonly from: 'event' | 'command' }
  /** A Subscription's Event changed, as the Snapshot spells it: the Releases side by side share its durable consumer. */
  | { readonly kind: 'event-changed'; readonly from: string; readonly to: string }
  /** A Definitions Package's export now names another Guard or Rejection, or another kind: a Service importing it gets something else. */
  | { readonly kind: 'export-changed'; readonly from: string; readonly to: string }
  /** An Endpoint renamed, with the Baseline's Visibility, since only its Callers knew the old name. */
  | {
      readonly kind: 'renamed';
      readonly from: string;
      readonly to: string;
      readonly baselineVisibility: Visibility;
    }
  /**
   * URLs this Endpoint won by routing precedence in the Baseline that an Endpoint the Baseline does
   * not declare wins now, named by its identity: this Endpoint's Input loses them.
   */
  | { readonly kind: 'shadowed'; readonly by: string }
  | { readonly kind: 'visibility-widened'; readonly from: Visibility; readonly to: Visibility }
  /** A Visibility narrowed: a Dependency may lose reach. */
  | { readonly kind: 'visibility-narrowed'; readonly from: Visibility; readonly to: Visibility }
  /**
   * A difference inside a schema, at its steps from the site, read in one Position; a shared schema
   * is read as a Message, the strongest.
   */
  | {
      readonly kind: 'schema';
      readonly at: readonly Step[];
      readonly position: Position;
      readonly shape: ShapeDifference;
    }
  /** A shared schema, a Guard or a Rejection gone from its Definitions Package. */
  | { readonly kind: 'removed' }
  /** A Success's or a code's HTTP status changed: Callers may depend on either. */
  | { readonly kind: 'status-changed'; readonly from: number; readonly to: number }
  /** An Endpoint's or a Rejection's body declared where the Baseline declared none. */
  | {
      readonly kind: 'body-added';
      readonly at: readonly Step[];
      readonly position: EndpointPosition;
    }
  /** An Endpoint's or a Rejection's body the Baseline declared and the proposed Snapshot no longer does. */
  | {
      readonly kind: 'body-removed';
      readonly at: readonly Step[];
      readonly position: EndpointPosition;
    }
  /** A path param renamed at its position: the URL is the same, and params are matched by position. */
  | { readonly kind: 'param-renamed'; readonly from: string; readonly to: string }
  /**
   * An optional Input header added whose schema refuses some text: a proxy, a gateway or a browser
   * may already send one under its name.
   */
  | { readonly kind: 'header-refuses-text'; readonly at: readonly Step[] }
  /** A code an Endpoint or a Guard answers that it did not. */
  | { readonly kind: 'rejection-added'; readonly code: string }
  /** A code an Endpoint or a Guard no longer answers. */
  | { readonly kind: 'rejection-removed'; readonly code: string };

/** A site with what differs at it, before each difference is classified. */
export type SiteDifferences = {
  readonly site: ChangeSite;
  readonly differences: readonly Difference[];
};

/** The class COMPATIBILITY.md gives a difference: Breaking, Additive or Neutral. */
export type ChangeClass = 'breaking' | 'additive' | 'neutral';

/**
 * What the Compatibility Check does with a Change: allows it, needs a Breaking Change Approval for
 * it, or refuses it, which fails the check whatever Approval is given.
 */
export type Verdict = 'allowed' | 'approval-needed' | 'refused';

/** A difference's class, and the Verdict on it. */
export type Classification = { readonly class: ChangeClass; readonly verdict: Verdict };

/** One difference the Compatibility Check found, with its class and Verdict. */
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
