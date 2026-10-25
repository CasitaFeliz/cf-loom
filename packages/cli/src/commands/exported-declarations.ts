import type { FileExport } from '../loading/index.ts';

/** Where a declaration is exported under its name in code, or the line saying why it is not. */
export type Located<At> =
  | { readonly kind: 'exported'; readonly at: At }
  | { readonly kind: 'refused'; readonly line: string };

/**
 * The first file, in code point order, that exports a declaration under `name`; or the line
 * saying that no file exports it, or that none does under `name`. `label` names the declaration.
 */
export function locatedUnderOf(
  label: string,
  name: string,
  exports: readonly FileExport[],
): Located<FileExport> {
  const named = exports.find((fileExport) => fileExport.name === name);
  if (named !== undefined) {
    return { kind: 'exported', at: named };
  }
  const line =
    exports.length === 0
      ? `${label} is exported by no file under src/contract/`
      : `${label} is not exported as ${name}`;
  return { kind: 'refused', line };
}
