import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import { type Fault, thrownFault } from '../outcomes/index.ts';

/** What running an implementation gave: what it built, or the Fault for what went wrong. */
export type Ran<Built> =
  | { readonly kind: 'built'; readonly built: Built }
  | { readonly kind: 'thrown'; readonly fault: Fault };

/**
 * Runs an implementation and awaits what it built; a throw, or a value that is not what its
 * Endpoint or Guard answers, is the Fault `Internal error` with what went wrong as `cause`.
 */
export async function ranOf<Built>(
  answering: Endpoint | Guard,
  implementation: () => unknown,
  isBuilt: (value: unknown) => value is Built,
): Promise<Ran<Built>> {
  try {
    const built = await implementation();
    if (isBuilt(built)) {
      return { kind: 'built', built };
    }
    const message = `${answering.name}'s Handler returned no Outcome but ${describedOf(built)}`;
    return { kind: 'thrown', fault: thrownFault(new TypeError(message)) };
  } catch (e) {
    return { kind: 'thrown', fault: thrownFault(e) };
  }
}

/** What a Handler returned instead of an Outcome, by its type or kind, never its content. */
function describedOf(built: unknown): string {
  if (built === null) {
    return 'null';
  }
  if (typeof built === 'object' && 'kind' in built) {
    return `the kind ${String(built.kind)}`;
  }
  return typeof built;
}
