import { reachOf } from '../written/index.ts';
import type { ServiceSnapshot } from './types.ts';

/**
 * The names of the Guards the named ones reach: each of them and, through its `guards`, every
 * Guard it builds on, each once; a name the Snapshot does not hold lists nothing.
 */
export function reachedGuardNamesOf(
  names: readonly string[],
  guards: ServiceSnapshot['guards'],
): ReadonlySet<string> {
  return new Set(reachOf(names, (name) => guards[name]?.guards ?? []));
}
