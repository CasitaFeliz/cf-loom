import { isRootKind } from '../loading/index.ts';
import type { Run } from '../project/index.ts';
import { check } from './check.ts';
import { type Exit, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { defaultPackageFolder, packageCommand } from './package.ts';
import { verify } from './verify.ts';

const usage =
  'Usage: cf-loom init [service | application | definitions] | generate | verify | package [--out <dir>] | check [--json]';

/** How a command prints: its lines, or, for `check`, one JSON document. */
export type Output = 'lines' | 'json';

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
