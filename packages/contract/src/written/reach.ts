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
  const frames: Listing<Key>[] = [];
  const enter = (guard: Key): void => {
    if (!seen.has(guard)) {
      seen.add(guard);
      frames.push({ guard, listed: listedBy(guard), next: 0 });
    }
  };
  for (const guard of guards) {
    enter(guard);
    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      if (frame.next === frame.listed.length) {
        frames.pop();
        reached.push(frame.guard);
      } else {
        enter(frame.listed[frame.next++] as Key);
      }
    }
  }
  return reached;
}

/** A Guard whose listed Guards are being reached, and how many have been. */
type Listing<Key> = { readonly guard: Key; readonly listed: readonly Key[]; next: number };

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
export function reachedCodesOf<Reaching, Reached>(
  reached: {
    readonly endpoints: readonly Reaching[];
    readonly guards: readonly Reached[];
  },
  read: {
    readonly ownCodesOf: (endpoint: Reaching) => readonly string[];
    readonly answeredBy: (guard: Reached) => readonly string[];
  },
): ReadonlySet<string> {
  const own = reached.endpoints.flatMap(read.ownCodesOf);
  const answered = reached.guards.flatMap(read.answeredBy);
  return new Set([...own, ...answered]);
}
