import { isRootKind, oneLineOf } from '../loading/index.ts';
import type { Run } from '../project/index.ts';
import { check, type Output } from './check.ts';
import { errorsExitOf } from './check-json.ts';
import { type Exit, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { defaultPackageFolder, packageCommand } from './package.ts';
import { verify } from './verify.ts';

const usage =
  'Usage: cf-loom init [service | application | definitions] | generate | verify | package [--out <dir>] | check [--json]';

/** How the CLI was called: the command and its arguments, and the options it was given. */
export type Called = {
  readonly positionals: readonly string[];
  readonly out?: string;
  readonly output: Output;
};

/** How the CLI is called wrongly: an unknown command, kind, option or argument, with the usage. */
export function usageError(message: string): Exit {
  return toolingError(`${message}. ${usage}`);
}

/** A throw, which is a bug of cf-loom, as the tooling error that says so, in the output the command prints. */
export function crashedExitOf(thrown: unknown, output: Output): Exit {
  const exit = toolingError(`cf-loom failed: ${oneLineOf(thrown, import.meta.dirname)}`);
  switch (output) {
    case 'lines':
      return exit;
    case 'json':
      return errorsExitOf(exit);
  }
}

/** Runs the command the arguments name where and when the CLI runs. */
export async function runCommand({ positionals, out, output }: Called, run: Run): Promise<Exit> {
  const [command, ...rest] = positionals;
  if (out !== undefined && command !== 'package') {
    return usageError('Only package takes --out');
  }
  if (output === 'json' && command !== 'check') {
    return usageError('Only check takes --json');
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
        : await packageCommand(run, out ?? defaultPackageFolder);
    case 'check':
      return rest.length > 0 ? usageError('check takes no argument') : await check(run, output);
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
