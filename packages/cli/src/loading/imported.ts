import { extname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A user's module as Node imported it, or why it could not be, in one line. */
export type Imported =
  | { readonly kind: 'imported'; readonly exports: Readonly<Record<string, unknown>> }
  | { readonly kind: 'failed'; readonly message: string };

/** Node's codes for TypeScript it cannot strip, whose stack starts at the file and line. */
const syntaxCodes: readonly unknown[] = [
  'ERR_INVALID_TYPESCRIPT_SYNTAX',
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
];

/**
 * Imports a user's TypeScript file with Node's own type stripping, so a broken file is one line
 * naming what broke, relative to the project in `directory`, and never a stack trace.
 */
export async function importedModuleOf(path: string, directory: string): Promise<Imported> {
  try {
    const exports: Readonly<Record<string, unknown>> = await import(pathToFileURL(path).href);
    return { kind: 'imported', exports };
  } catch (e) {
    return { kind: 'failed', message: thrownLineOf(e, directory) };
  }
}

/** What a user's code threw, as one line with the project's paths relative to it. */
export function thrownLineOf(thrown: unknown, directory: string): string {
  if (!(thrown instanceof Error)) {
    return String(thrown);
  }
  const message = firstLineOf(thrown.message).replaceAll(`${directory}${sep}`, '');
  const code = 'code' in thrown ? thrown.code : undefined;
  if (syntaxCodes.includes(code)) {
    return `${syntaxLocationOf(thrown, directory)}${message}`;
  }
  if (code === 'ERR_MODULE_NOT_FOUND' && isExtensionless(thrown.message)) {
    return `${message}: relative imports name the .ts file`;
  }
  return message;
}

/** Where Node found TypeScript it cannot strip: the first line of its stack, `file:///…:line`. */
function syntaxLocationOf(thrown: Error, directory: string): string {
  const located = /^(file:\/\/\S+?):(\d+)/.exec(thrown.stack ?? '');
  if (located?.[1] === undefined) {
    return '';
  }
  return `${relative(directory, fileURLToPath(located[1]))}:${located[2]}: `;
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
