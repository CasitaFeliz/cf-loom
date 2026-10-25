import { defaultImportsOf, pathOfSpecifier } from '../source-text/index.ts';
import { type LocalParts, localPartsOf } from './code-names.ts';

/** A Handler a Handler map imports: what its local name stands for, that name, and where its file is. */
export type RecordedHandler = LocalParts & { readonly local: string; readonly path: string };

/** The Handlers the text of the Handler map at `mapPath` imports, which is what cf-loom placed. */
export function recordedHandlersOf(mapPath: string, text: string): readonly RecordedHandler[] {
  const recorded: RecordedHandler[] = [];
  for (const { local, specifier } of defaultImportsOf(text)) {
    const parts = localPartsOf(local);
    if (parts !== undefined) {
      recorded.push({ ...parts, local, path: pathOfSpecifier(mapPath, specifier) });
    }
  }
  return recorded;
}
