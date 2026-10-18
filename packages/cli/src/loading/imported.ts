import { extname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A user's module as Node imported it, or why it could not be, in one line. */
export type Imported =
  | { readonly kind: 'imported'; readonly exports: Readonly<Record<string, unknown>> }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Imports a user's TypeScript file with Node's own type stripping, so a broken file is one line
 * naming what broke, relative to the project in `directory`, and never a stack trace.
 */
export async function importedModuleOf(path: string, directory: string): Promise<Imported> {
  try {
    const exports: Readonly<Record<string, unknown>> = await import(pathToFileURL(path).href);
    return { kind: 'imported', exports };
  } catch (e) {
    return { kind: 'failed', message: oneLineOf(e, directory) };
  }
}

/**
 * Renders anything thrown as one line: where in the project it was thrown when its stack says
 * so, with the project's paths relative to it.
 */
export function oneLineOf(thrown: unknown, directory: string): string {
  if (!(thrown instanceof Error)) {
    return relativeTo(firstLineOf(String(thrown)), directory);
  }
  const message = relativeTo(firstLineOf(thrown.message), directory);
  const code = 'code' in thrown ? thrown.code : undefined;
  if (code === 'ERR_MODULE_NOT_FOUND' && isExtensionless(thrown.message)) {
    return `${message}: relative imports name the .ts file`;
  }
  return `${projectFrameOf(thrown, directory)}${message}`;
}

/**
 * The first place of the stack in the project's own files, `file:line: `: where Node found
 * TypeScript it cannot strip, or where the user's code threw; nothing when no frame is the user's.
 */
function projectFrameOf(thrown: Error, directory: string): string {
  const frames = [...(thrown.stack ?? '').matchAll(/(file:\/\/[^\s)]+?):(\d+)(?::\d+)?/g)];
  for (const [, url, line] of frames) {
    const path = url === undefined ? '' : relative(directory, fileURLToPath(url));
    if (!path.startsWith('..') && !path.split(sep).includes('node_modules')) {
      return `${path}:${line}: `;
    }
  }
  return '';
}

/** A text with the project's paths, as file URLs or paths, relative to the project. */
function relativeTo(text: string, directory: string): string {
  const url = `${pathToFileURL(directory).href}/`;
  return text.replaceAll(url, '').replaceAll(`${directory}${sep}`, '');
}

/** The extensions a module Node imports may have; any other is part of a file's name. */
const moduleExtensions: readonly string[] = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'];

/** Whether the file Node could not find was named without its extension, as `./get-order.endpoint`. */
function isExtensionless(message: string): boolean {
  const missing = /^Cannot find module '([^']+)'/.exec(message)?.[1];
  return missing !== undefined && !moduleExtensions.includes(extname(missing));
}

function firstLineOf(text: string): string {
  return text.split('\n', 1)[0] ?? '';
}
