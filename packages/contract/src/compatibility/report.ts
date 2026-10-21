import type { Visibility } from '../declarations/index.ts';

/**
 * Where a Change is: an Element by identity, with its Visibility, which decides the bump. When the
 * Visibility moved, it is the wider of the two; when the Element is on one side only, that side's.
 */
export type ChangeSite =
  | { readonly kind: 'endpoint'; readonly identity: string; readonly visibility: Visibility }
  | { readonly kind: 'event'; readonly identity: string; readonly visibility: Visibility }
  | { readonly kind: 'command'; readonly identity: string };

/** A Dependency the dependency graph holds on an Element: the Contract Package that declares it, at a version. */
export type GraphDependency = { readonly name: string; readonly version: string };

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
  | { readonly kind: 'visibility-narrowed'; readonly from: Visibility; readonly to: Visibility };

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
