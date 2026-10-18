#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { type Exit, runCommand, usageError } from './commands/index.ts';

/** Runs the command the arguments name; `--out <dir>` is the one option, any other a usage error. */
async function exitOf(args: readonly string[]): Promise<Exit> {
  const { positionals, tokens, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: { out: { type: 'string' } },
  });
  const unknown = tokens.find((token) => token.kind === 'option' && token.name !== 'out');
  if (unknown !== undefined && unknown.kind === 'option') {
    return usageError(`Unknown option: ${unknown.rawName}`);
  }
  const { out } = values;
  if (out !== undefined && typeof out !== 'string') {
    return usageError('--out takes a folder');
  }
  const called = out === undefined ? { positionals } : { positionals, out };
  return await runCommand(called, { cwd: process.cwd(), now: Date.now() });
}

const exit = await exitOf(process.argv.slice(2));
for (const line of exit.stdout) {
  process.stdout.write(`${line}\n`);
}
for (const line of exit.stderr) {
  process.stderr.write(`${line}\n`);
}
process.exitCode = exit.status;
