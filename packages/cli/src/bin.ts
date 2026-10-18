#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { type Exit, runCommand, usageError } from './commands/index.ts';

/** Runs the command the arguments name; the CLI takes no option, so any option is a usage error. */
async function exitOf(args: readonly string[]): Promise<Exit> {
  const { positionals, tokens } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: {},
  });
  const option = tokens.find((token) => token.kind === 'option');
  if (option !== undefined) {
    return usageError(`Unknown option: ${option.rawName}`);
  }
  return await runCommand(positionals, { cwd: process.cwd(), now: Date.now() });
}

const exit = await exitOf(process.argv.slice(2));
for (const line of exit.stdout) {
  process.stdout.write(`${line}\n`);
}
for (const line of exit.stderr) {
  process.stderr.write(`${line}\n`);
}
process.exitCode = exit.status;
