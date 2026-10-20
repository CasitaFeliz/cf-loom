import type { EventSnapshot } from '@cf-loom/contract/internal';
import { stringLiteralOf } from '../source-text/index.ts';

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
  switch (lifecycle) {
    case 'active':
      return [];
    case 'deprecated':
      return [`  lifecycle: ${stringLiteralOf(lifecycle)},`];
    case 'retired':
      throw new Error('The exported Snapshot holds no Retired Element: a bug.');
  }
}
