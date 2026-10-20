import { type HandledElement, isMessageElement } from './elements.ts';
import { elementNameOf } from './errors.ts';

/** What an implementation returned: what it built, or a `TypeError` naming a value it may not return. */
export type Returned<Built> =
  | { readonly kind: 'built'; readonly built: Built }
  | { readonly kind: 'not-built'; readonly cause: TypeError };

/**
 * Runs an implementation and awaits what it built; a value that is not what its Element answers is
 * `not-built`, with a `TypeError` naming what came back.
 */
export async function returnedOf<Built>(
  element: HandledElement,
  implementation: () => unknown,
  isBuilt: (value: unknown) => value is Built,
): Promise<Returned<Built>> {
  const built = await implementation();
  if (isBuilt(built)) {
    return { kind: 'built', built };
  }
  const named = `${elementNameOf(element)}'s Handler returned no ${answeredOf(element)}`;
  return { kind: 'not-built', cause: new TypeError(`${named} but ${describedOf(built)}`) };
}

/** What a Handler answers, by its Element: a Message Handler a Fault or nothing, any other an Outcome. */
function answeredOf(element: HandledElement): string {
  return isMessageElement(element) ? 'Fault' : 'Outcome';
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
