import type {
  DefinitionsSnapshot,
  EndpointSnapshot,
  GuardSnapshot,
  PublishedDefinitionsSnapshot,
  PublishedServiceSnapshot,
  ServiceSnapshot,
} from '../snapshot/index.ts';
import { answeredDifferencesOf } from './codes.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import { guardNeutralOf, guardSourcesOf } from './neutral.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { partsOf } from './steps.ts';
import { inputHeaderDifferencesOf, textPartDifferencesOf } from './text-parts.ts';
import { widestVisibilitiesOf } from './visibility.ts';

/**
 * A Definitions Package's Guards by name in code point order: added, removed, or their demands read
 * as Input and the codes they answer, then what no rule compares, which is Neutral.
 */
export function guardDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  return counterpartsOf(baseline.guards, proposed.guards).map(
    (guard): SiteDifferences => ({
      site: { kind: 'guard', name: guard.key, visibility: 'public' },
      differences: differencesOf(guard, defs),
    }),
  );
}

function differencesOf(guard: Counterpart<GuardSnapshot>, defs: BothDefs): readonly Difference[] {
  switch (guard.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return [{ kind: 'removed' }];
    case 'kept':
      return keptDifferencesOf(guard.baseline, guard.proposed, defs);
  }
}

/**
 * A Guard's demands are Input, its query then its headers, then the codes it answers and what no
 * rule compares.
 */
function keptDifferencesOf(
  baseline: GuardSnapshot,
  proposed: GuardSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const query = { baseline: baseline.demands.query, proposed: proposed.demands.query };
  const headers = { baseline: baseline.demands.headers, proposed: proposed.demands.headers };
  return [
    ...textPartDifferencesOf(query, defs, { position: 'input', at: partsOf('demands', 'query') }),
    ...inputHeaderDifferencesOf(headers, defs, partsOf('demands', 'headers')),
    ...answeredDifferencesOf(baseline.rejections, proposed.rejections),
    ...guardNeutralOf(baseline, proposed, defs),
  ];
}

/**
 * A Service's Guards by name in code point order, each Neutral: what it demands and answers, whose
 * effect the Endpoints that attach it report, and what no rule compares. A Guard's site takes the
 * widest Visibility of the Endpoints that attach it, Private when none does.
 */
export function serviceGuardDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  const visibilities = widestVisibilitiesOf(baseline, proposed, attachedGuardsOf);
  return counterpartsOf(baseline.guards, proposed.guards).map(
    (guard): SiteDifferences => ({
      site: {
        kind: 'guard',
        name: guard.key,
        visibility: visibilities.get(guard.key) ?? 'private',
      },
      differences: guard.kind === 'kept' ? keptServiceDifferencesOf(guard, defs) : [],
    }),
  );
}

/** A Service's kept Guard: what it demands and answers, then what no rule compares. */
function keptServiceDifferencesOf(
  { baseline, proposed }: Extract<Counterpart<GuardSnapshot>, { readonly kind: 'kept' }>,
  defs: BothDefs,
): readonly Difference[] {
  return [...guardSourcesOf(baseline, proposed, defs), ...guardNeutralOf(baseline, proposed, defs)];
}

function attachedGuardsOf(endpoint: EndpointSnapshot): readonly string[] {
  return endpoint.guards.map(({ guard }) => guard);
}
