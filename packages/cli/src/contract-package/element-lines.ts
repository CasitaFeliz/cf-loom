import type { EventSnapshot } from '@cf-loom/contract/internal';
import { docCommentOf, stringLiteralOf } from '../source-text/index.ts';

/**
 * The fields every exported Element writes, in one order: its Visibility, its description, and its
 * lifecycle, left out when Active.
 */
export function elementLinesOf(
  element: Pick<EventSnapshot, 'visibility' | 'description' | 'lifecycle'>,
): readonly string[] {
  return [
    `  visibility: ${stringLiteralOf(element.visibility)},`,
    `  description: ${stringLiteralOf(element.description)},`,
    ...lifecycleLinesOf(element.lifecycle),
  ];
}

/** A lifecycle as `define*` takes it: Active left out, Deprecated written. */
function lifecycleLinesOf(lifecycle: EventSnapshot['lifecycle']): readonly string[] {
  return isDeprecated(lifecycle) ? [`  lifecycle: ${stringLiteralOf(lifecycle)},`] : [];
}

/**
 * The `@deprecated` comment above a Deprecated Element's export, with its description, so a
 * Consumer's editor flags each use of it; none for an Active one.
 */
export function deprecatedLinesOf(
  element: Pick<EventSnapshot, 'description' | 'lifecycle'>,
): readonly string[] {
  if (!isDeprecated(element.lifecycle)) {
    return [];
  }
  return docCommentOf(`@deprecated ${element.description}`);
}

function isDeprecated(lifecycle: EventSnapshot['lifecycle']): boolean {
  switch (lifecycle) {
    case 'active':
      return false;
    case 'deprecated':
      return true;
    case 'retired':
      throw new Error('The exported Snapshot holds no Retired Element: a bug.');
  }
}
