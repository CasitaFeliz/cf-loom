import { isRootKind } from '../loading/index.ts';
import type { Run } from '../project/index.ts';
import { type Exit, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { defaultPackageFolder, writeContractPackage } from './package.ts';
import { verify } from './verify.ts';

const usage =
  'Usage: cf-loom init [service | application | definitions] | generate | verify | package [--out <dir>]';

/** How the CLI was called: the command and its arguments, and the options it was given. */
export type Called = { readonly positionals: readonly string[]; readonly out?: string };

/** How the CLI is called wrongly: an unknown command, kind, option or argument, with the usage. */
export function usageError(message: string): Exit {
  return toolingError(`${message}. ${usage}`);
}

/** Runs the command the arguments name where and when the CLI runs. */
export async function runCommand({ positionals, out }: Called, run: Run): Promise<Exit> {
  const [command, ...rest] = positionals;
  if (out !== undefined && command !== 'package') {
    return usageError('Only package takes --out');
  }
  switch (command) {
    case 'init':
      return initOf(rest, run);
    case 'generate':
      return rest.length > 0 ? usageError('generate takes no argument') : await generate(run);
    case 'verify':
      return rest.length > 0 ? usageError('verify takes no argument') : await verify(run);
    case 'package':
      return rest.length > 0
        ? usageError('package takes no argument')
        : await writeContractPackage(run, out ?? defaultPackageFolder);
    default:
      return usageError(`Unknown command: ${command ?? '(none)'}`);
  }
}

function initOf(rest: readonly string[], run: Run): Exit {
  const [kind = 'service', ...more] = rest;
  if (more.length > 0) {
    return usageError('init takes one kind');
  }
  return isRootKind(kind) ? init(run, kind) : usageError(`Unknown kind: ${kind}`);
}
