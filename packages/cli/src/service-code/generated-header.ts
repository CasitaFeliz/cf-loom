import { headerOf } from '../source-text/index.ts';

/**
 * Whether a file starts with the line `generate` writes first, so a file left at a path the layout
 * no longer names is found, whatever an editor made of its first line's ends.
 */
export function isWrittenByGenerate(text: string): boolean {
  const first = text.split('\n', 1)[0] ?? '';
  return first.replace(/^﻿/, '').replace(/\r$/, '') === headerOf('generate');
}
