import { pathToFileURL } from 'node:url';

/** A user's module as Node imported it, or why it could not be. */
export type Imported =
  | { readonly kind: 'imported'; readonly exports: Readonly<Record<string, unknown>> }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Imports a user's TypeScript file with Node's own type stripping, so a broken file is a failure
 * to report and never a stack trace.
 */
export async function importedModuleOf(path: string): Promise<Imported> {
  try {
    const exports: Readonly<Record<string, unknown>> = await import(pathToFileURL(path).href);
    return { kind: 'imported', exports };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}
