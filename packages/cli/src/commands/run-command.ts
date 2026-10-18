import { isRootKind } from '../loading/index.ts';
import { type Exit, type Run, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { verify } from './verify.ts';

const usage = 'Usage: cf-loom init [service | application | definitions] | generate | verify';

/** How the CLI is called wrongly: an unknown command, kind, option or argument, with the usage. */
export function usageError(message: string): Exit {
  return toolingError(`${message}. ${usage}`);
}

/** Runs the command the arguments name where and when the CLI runs. */
export async function runCommand(positionals: readonly string[], run: Run): Promise<Exit> {
  const [command, ...rest] = positionals;
  switch (command) {
    case 'init':
      return initOf(rest, run);
    case 'generate':
      return rest.length > 0 ? usageError('generate takes no argument') : await generate(run);
    case 'verify':
      return rest.length > 0 ? usageError('verify takes no argument') : await verify(run);
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
