import type { Lifecycle } from '../declarations/index.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';

/** Whether an Element is there at all: added, deleted with or without having been Retired, or reusing a Retired identity. */
export function presenceDifferenceOf(
  pair: Pair<{ readonly lifecycle: Lifecycle }>,
): Difference | undefined {
  switch (pair.kind) {
    case 'added':
      return { kind: 'added' };
    case 'dropped':
      return pair.baseline.lifecycle === 'retired' ? { kind: 'tombstoned' } : { kind: 'deleted' };
    case 'reused':
      return { kind: 'identity-reused' };
    case 'kept':
    case 'retired':
      return undefined;
  }
}
