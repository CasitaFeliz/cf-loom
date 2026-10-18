#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { type Exit, runCommand, usageError } from './commands/index.ts';

/** The CLI's arguments, with an unknown option a usage error rather than a stack trace. */
async function exitOf(args: readonly string[]): Promise<Exit> {
  try {
    const { positionals } = parseArgs({ args: [...args], allowPositionals: true, options: {} });
    return await runCommand(positionals, { cwd: process.cwd(), now: Date.now() });
  } catch (e) {
    if (e instanceof TypeError && 'code' in e && e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      return usageError(e.message);
    }
    throw e;
  }
}

const exit = await exitOf(process.argv.slice(2));
for (const line of exit.stdout) {
  process.stdout.write(`${line}\n`);
}
for (const line of exit.stderr) {
  process.stderr.write(`${line}\n`);
}
process.exitCode = exit.status;
