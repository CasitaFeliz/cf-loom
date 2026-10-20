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
    ...(element.lifecycle === 'active'
      ? []
      : [`  lifecycle: ${stringLiteralOf(element.lifecycle)},`]),
  ];
}
