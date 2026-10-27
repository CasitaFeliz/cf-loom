import type { FileExport } from '../loading/index.ts';

/** Where a declaration is exported, or the line saying why it is not. */
export type Located<At> =
  | { readonly kind: 'exported'; readonly at: At }
  | { readonly kind: 'refused'; readonly line: string };

/**
 * The first export of a declaration, in code point order of file and then export name, or the
 * line saying that no file exports it. `label` names the declaration.
 */
export function exportedAtOf(label: string, exports: readonly FileExport[]): Located<FileExport> {
  const [first] = exports;
  if (first === undefined) {
    return { kind: 'refused', line: `${label} is exported by no file under src/contract/` };
  }
  return { kind: 'exported', at: first };
}
