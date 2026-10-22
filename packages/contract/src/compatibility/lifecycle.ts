import type { Lifecycle } from '../declarations/index.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';

/**
 * How an Element's lifecycle moved: from none, for an added Element, or from the Baseline's. An
 * Element that reuses a Retired identity moved nowhere, since no other rule runs on it.
 */
export function lifecycleDifferenceOf(
  pair: Pair<{ readonly lifecycle: Lifecycle }>,
): Difference | undefined {
  switch (pair.kind) {
    case 'added':
      return movedTo(pair.proposed.lifecycle, undefined);
    case 'kept':
      return movedTo(pair.proposed.lifecycle, pair.baseline.lifecycle);
    case 'dropped':
    case 'reused':
      return undefined;
  }
}

function movedTo(to: Lifecycle, from: Lifecycle | undefined): Difference | undefined {
  if (from === 'retired') {
    return to === 'retired' ? undefined : { kind: 'retired-brought-back', lifecycle: to };
  }
  switch (to) {
    case 'active':
      return from === 'deprecated' ? { kind: 'reactivated' } : undefined;
    case 'deprecated':
      return from === 'active' ? { kind: 'deprecated' } : undefined;
    case 'retired':
      return from === 'deprecated' ? { kind: 'retired' } : { kind: 'retired-before-deprecated' };
  }
}
