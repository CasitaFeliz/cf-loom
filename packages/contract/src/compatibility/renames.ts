import type { EndpointSnapshot } from '../snapshot/index.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';

/** Whether an Endpoint kept its method and path and changed its name, with the Baseline's Visibility, since only its Callers knew the old name. */
export function renameDifferenceOf(pair: Pair<EndpointSnapshot>): Difference | undefined {
  if (pair.kind !== 'kept' || pair.baseline.name === pair.proposed.name) {
    return undefined;
  }
  return {
    kind: 'renamed',
    from: pair.baseline.name,
    to: pair.proposed.name,
    baselineVisibility: pair.baseline.visibility,
  };
}
