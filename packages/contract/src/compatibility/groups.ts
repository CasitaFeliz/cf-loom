import type { PublishedServiceSnapshot, ServiceSnapshot } from '../snapshot/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { widestGroupVisibilitiesOf } from './visibility.ts';

type KeptGroup = Extract<
  Counterpart<PublishedServiceSnapshot['groups'][string], ServiceSnapshot['groups'][string]>,
  { readonly kind: 'kept' }
>;

/**
 * A Service's Groups by name in code point order, each Neutral: a kept Group's description. A
 * Group added or removed comes with the Change of the Elements it lists, which name it or no
 * longer do, so it has none of its own. A Group's site takes the widest Visibility of what it lists.
 */
export function groupDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  const visibilities = widestGroupVisibilitiesOf(baseline, proposed);
  return counterpartsOf(baseline.groups, proposed.groups)
    .filter(isKept)
    .map(
      (group): SiteDifferences => ({
        site: {
          kind: 'group',
          name: group.key,
          visibility: visibilities.get(group.key) ?? 'private',
        },
        differences: descriptionDifferencesOf(group),
      }),
    );
}

function isKept(counterpart: Counterpart<unknown>): counterpart is KeptGroup {
  return counterpart.kind === 'kept';
}

function descriptionDifferencesOf({ baseline, proposed }: KeptGroup): readonly Difference[] {
  return baseline.description === proposed.description ? [] : [{ kind: 'description-changed' }];
}
