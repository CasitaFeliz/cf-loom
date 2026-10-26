import type { Visibility } from '../declarations/index.ts';
import { standardRejectionNames } from '../declarations/index.ts';
import type {
  DefinitionsSnapshot,
  PublishedDefinitionsSnapshot,
  PublishedServiceSnapshot,
  ServiceSnapshot,
} from '../snapshot/index.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { widerOf, widestVisibilitiesOf } from './visibility.ts';

type Standard = ServiceSnapshot['standardRejections'];

/** The code a Standard Rejection resolved to before and resolves to now. */
type Resolution = { readonly from: string; readonly to: string };

/**
 * A Service's Standard Rejections by name, each resolved to another code or not: the Endpoints
 * that list it report the codes, so the resolution itself is Neutral. A site's Visibility is the
 * widest of the Endpoints that list either code, Private when none does.
 */
export function serviceStandardRejectionDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  const visibilities = widestVisibilitiesOf(baseline, proposed, (endpoint) => endpoint.rejections);
  const visibilityOf = ({ from, to }: Resolution): Visibility =>
    widerOf(visibilities.get(from) ?? 'private', visibilities.get(to) ?? 'private');
  return sitesOf(baseline.standardRejections, proposed.standardRejections, visibilityOf);
}

/** A Definitions Package's Standard Rejections by name, each Public, since the Services that import it may use all of it. */
export function definitionsStandardRejectionDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  return sitesOf(baseline.standardRejections, proposed.standardRejections, () => 'public');
}

function sitesOf(
  baseline: Standard,
  proposed: Standard,
  visibilityOf: (resolution: Resolution) => Visibility,
): readonly SiteDifferences[] {
  return standardRejectionNames.map((name): SiteDifferences => {
    const resolution = { from: baseline[name], to: proposed[name] };
    const differences: readonly Difference[] =
      resolution.from === resolution.to ? [] : [{ kind: 'code-changed', ...resolution }];
    return {
      site: { kind: 'standard-rejection', name, visibility: visibilityOf(resolution) },
      differences,
    };
  });
}
