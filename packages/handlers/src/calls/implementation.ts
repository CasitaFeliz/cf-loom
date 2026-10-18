import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import { type Fault, thrownFault } from '../outcomes/index.ts';

/** What an implementation returned: what it built, or the Fault for a value that is no Outcome. */
export type Returned<Built> =
  | { readonly kind: 'built'; readonly built: Built }
  | { readonly kind: 'thrown'; readonly fault: Fault };

/**
 * Runs an implementation and awaits what it built; a value that is not what its Endpoint or Guard
 * answers is the Fault `Internal error`, with a `TypeError` naming what came back as `cause`.
 */
export async function returnedOf<Built>(
  answering: Endpoint | Guard,
  implementation: () => unknown,
  isBuilt: (value: unknown) => value is Built,
): Promise<Returned<Built>> {
  const built = await implementation();
  if (isBuilt(built)) {
    return { kind: 'built', built };
  }
  const message = `${answering.name}'s Handler returned no Outcome but ${describedOf(built)}`;
  return { kind: 'thrown', fault: thrownFault(new TypeError(message)) };
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
