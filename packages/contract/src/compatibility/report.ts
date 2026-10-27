import type { Visibility } from '../declarations/index.ts';
import type { ChangedSite, Step } from '../walker/index.ts';
import type { ShapeDifference } from './shape-differences.ts';

/**
 * Where a Change is, with the Visibility that decides its bump: the wider of the Baseline's and
 * the proposed one when it moved, else the side the Element is on. By kind:
 *
 * - an Endpoint: its proposed name, or the Baseline's when it is dropped;
 * - a Command: always Private;
 * - a code, which is no Element: the widest of the Endpoints that answer it before or after the
 *   change, Private when none does, Public in a Definitions Package;
 * - a Subscription or a Dependency: Private, since no Consumer relies on what a Service itself
 *   consumes;
 * - a Service's Guard: the widest of the Endpoints that attach it; a Definitions Package's: Public;
 * - a Service's Group: the widest of the Endpoints and Events it lists that are not Retired,
 *   Private when none;
 * - a Definitions Package's export: Public, since the Services that import it may use all of it;
 * - a Standard Rejection: the widest of the Endpoints that list either code, Private when none
 *   does, Public in a Definitions Package.
 */
export type ChangeSite = ChangedSite & { readonly visibility: Visibility };

/**
 * Where a shape is read, which decides what makes a change to it Breaking: Input, Success (a
 * Rejection's body included) or Message.
 */
export type Position = 'input' | 'success' | 'message';

/** Where an Endpoint's part is read: as Input by the Service, or as Success by a Caller. */
export type EndpointPosition = Exclude<Position, 'message'>;

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
  /** A Subscription's Event changed, as the Snapshot spells it: the Releases side by side share its Durable consumer. */
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
  | { readonly kind: 'rejection-removed'; readonly code: string }
  /** A Deprecated Endpoint's `deprecatedAt` moved: its `Deprecation` header names another instant. */
  | { readonly kind: 'deprecation-moved'; readonly from: string; readonly to: string }
  /** An Endpoint's, Message Version's, Guard's, Subscription's or Group's description changed. */
  | { readonly kind: 'description-changed' }
  /** An Endpoint, Message Version or Subscription moved to another Group. */
  | { readonly kind: 'group-changed'; readonly from: string; readonly to: string }
  /** An Endpoint's Attachments changed: which Guards, their order or their Qualifiers. */
  | { readonly kind: 'attachments-changed' }
  /** The Guards a Guard builds on changed. */
  | { readonly kind: 'guards-changed' }
  /** A Guard's Qualifier schema changed. */
  | { readonly kind: 'qualifier-changed' }
  /** The Context a Guard provides changed. */
  | { readonly kind: 'context-changed' }
  /** A Guard or a code now comes from another package, as the Snapshot spells it. */
  | { readonly kind: 'origin-changed'; readonly from: string; readonly to: string }
  /** A Rejection's message changed. */
  | { readonly kind: 'message-changed' }
  /** A Provider is declared against at another version. */
  | { readonly kind: 'against-changed'; readonly from: string; readonly to: string }
  /** A Dependency lists an Endpoint of its Provider that none listed before. */
  | { readonly kind: 'endpoint-added'; readonly id: string; readonly name: string }
  /** No Dependency lists an Endpoint of its Provider any longer. */
  | { readonly kind: 'endpoint-removed'; readonly id: string; readonly name: string }
  /** An Endpoint a Dependency lists is named otherwise by the Provider version the Contract adopted. */
  | {
      readonly kind: 'endpoint-renamed';
      readonly id: string;
      readonly from: string;
      readonly to: string;
    }
  /** What an Element Retired in the proposed Snapshot still declares changed; nothing reads it. */
  | { readonly kind: 'retired-changed' }
  /** A Standard Rejection resolves to another code; the Endpoints that list it report the codes. */
  | { readonly kind: 'code-changed'; readonly from: string; readonly to: string }
  /** What a Service's Guard demands changed; its effect is judged on the Endpoints that attach it. */
  | { readonly kind: 'demands-changed' }
  /** The codes a Service's Guard answers changed; its effect is judged on the Endpoints that attach it. */
  | { readonly kind: 'rejections-changed' };

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

/** A Compatibility Check that compared, with its Changes in order; a Snapshot with none is the Baseline's. */
export type ComparedReport = {
  readonly changes: readonly Change[];
};
