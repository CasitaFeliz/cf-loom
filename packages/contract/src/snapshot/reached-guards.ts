import type { GuardSnapshot, ServiceSnapshot } from './types.ts';

/**
 * The names of the Guards the named ones reach: each of them and, through its `guards`, every
 * Guard it builds on, each once; a name the Snapshot does not hold reaches nothing.
 */
export function reachedGuardNamesOf(
  names: readonly string[],
  guards: ServiceSnapshot['guards'],
): ReadonlySet<string> {
  const reached = new Set<string>();
  function enter(name: string, guard: GuardSnapshot | undefined): void {
    if (guard === undefined || reached.has(name)) {
      return;
    }
    reached.add(name);
    for (const listed of guard.guards) {
      enter(listed, guards[listed]);
    }
  }
  for (const name of names) {
    enter(name, guards[name]);
  }
  return reached;
}
