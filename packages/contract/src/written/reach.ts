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

/**
 * Every code some Endpoints reach, each once: those an Endpoint lists itself and those a Guard they
 * reach answers; the caller gives the Guards they reach and reads each one's codes.
 */
export function reachedCodesOf<EndpointEntry, GuardEntry>(
  reached: {
    readonly endpoints: readonly EndpointEntry[];
    readonly guards: readonly GuardEntry[];
  },
  read: {
    readonly ownCodesOf: (endpoint: EndpointEntry) => readonly string[];
    readonly answeredBy: (guard: GuardEntry) => readonly string[];
  },
): ReadonlySet<string> {
  const own = reached.endpoints.flatMap(read.ownCodesOf);
  const answered = reached.guards.flatMap(read.answeredBy);
  return new Set([...own, ...answered]);
}
