import { type Guard, isGuard } from '../declarations/index.ts';
import { listOf } from './written.ts';

/**
 * Every Guard the given ones reach, each once, the Guards one lists before it: themselves and, at
 * any depth, the ones `listedBy` says each lists.
 */
export function reachOf<Key>(
  guards: readonly Key[],
  listedBy: (guard: Key) => readonly Key[],
): readonly Key[] {
  const seen = new Set<Key>();
  const reached: Key[] = [];
  const visit = (guard: Key): void => {
    if (seen.has(guard)) {
      return;
    }
    seen.add(guard);
    listedBy(guard).forEach(visit);
    reached.push(guard);
  };
  guards.forEach(visit);
  return reached;
}

/**
 * Every Guard the given ones reach, each once, the Guards one lists before it: themselves and,
 * through `guards`, the ones they name; what names no Guard is left out.
 */
export function reachedGuardsOf(guards: readonly unknown[]): readonly Guard[] {
  return reachOf(guards.filter(isGuard), (guard) => listOf(guard.guards).filter(isGuard));
}
