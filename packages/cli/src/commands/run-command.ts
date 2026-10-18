import { type Exit, type Run, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { verify } from './verify.ts';

/** How the CLI is called wrongly: an unknown command, option or argument. */
export function usageError(message: string): Exit {
  return toolingError(`${message}: the commands are init, generate, verify`);
}

/** Runs the command the arguments name where and when the CLI runs. */
export async function runCommand(positionals: readonly string[], run: Run): Promise<Exit> {
  const [command, ...rest] = positionals;
  switch (command) {
    case 'init':
      return rest.length > 1 ? usageError('init takes one kind') : init(run, rest[0]);
    case 'generate':
      return rest.length > 0 ? usageError('generate takes no argument') : await generate(run);
    case 'verify':
      return rest.length > 0 ? usageError('verify takes no argument') : await verify(run);
    default:
      return usageError(`Unknown command: ${command ?? '(none)'}`);
  }
}
