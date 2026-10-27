import { nameOf } from './errors.ts';
import type { Handled } from './handled.ts';

/** What an implementation returned: what it built, or a `TypeError` naming a value it may not return. */
export type Returned<Built> =
  | { readonly kind: 'built'; readonly built: Built }
  | { readonly kind: 'not-built'; readonly cause: TypeError };

/**
 * Runs an implementation and awaits what it built; a value that is not what its declaration answers is
 * `not-built`, with a `TypeError` naming what came back.
 */
export async function returnedOf<Built>(
  declaration: Handled,
  implementation: () => unknown,
  isBuilt: (value: unknown) => value is Built,
): Promise<Returned<Built>> {
  const built = await implementation();
  if (isBuilt(built)) {
    return { kind: 'built', built };
  }
  const named = `${nameOf(declaration)}'s Handler returned no ${answeredOf(declaration)}`;
  return { kind: 'not-built', cause: new TypeError(`${named} but ${describedOf(built)}`) };
}

/** What a Handler answers, by its declaration: an EndpointHandler an Outcome, a GuardHandler an Admission, a Message Handler a Fault or nothing. */
function answeredOf(declaration: Handled): string {
  switch (declaration.kind) {
    case 'endpoint':
      return 'Outcome';
    case 'guard':
      return 'Admission';
    case 'command':
    case 'subscription':
      return 'Fault';
  }
}

/** What a Handler returned instead of what it answers, by its type or kind, never its content. */
function describedOf(built: unknown): string {
  if (built === null) {
    return 'null';
  }
  if (typeof built === 'object' && 'kind' in built) {
    return `the kind ${String(built.kind)}`;
  }
  return typeof built;
}
