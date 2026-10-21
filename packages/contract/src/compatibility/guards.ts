import type {
  DefinitionsSnapshot,
  GuardSnapshot,
  PublishedDefinitionsSnapshot,
} from '../snapshot/index.ts';
import { answeredDifferencesOf } from './codes.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { inputHeaderDifferencesOf, textPartDifferencesOf } from './text-parts.ts';

/**
 * A Definitions Package's Guards by name in code point order: added, removed, or their demands read
 * as Input and the codes they answer; their Context, `guards` and `qualifier` are Neutral.
 */
export function guardDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  return counterpartsOf(baseline.guards, proposed.guards).map(
    (guard): SiteDifferences => ({
      site: { kind: 'guard', name: guard.key },
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

/** A Guard's demands are Input, its query then its headers, then the codes it answers. */
function keptDifferencesOf(
  baseline: GuardSnapshot,
  proposed: GuardSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const query = { baseline: baseline.demands.query, proposed: proposed.demands.query };
  const headers = { baseline: baseline.demands.headers, proposed: proposed.demands.headers };
  return [
    ...textPartDifferencesOf(query, defs, { position: 'input', at: ['demands', 'query'] }),
    ...inputHeaderDifferencesOf(headers, defs, ['demands', 'headers']),
    ...answeredDifferencesOf(baseline.rejections, proposed.rejections),
  ];
}
