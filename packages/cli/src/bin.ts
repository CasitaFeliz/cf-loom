#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { type Exit, type Output, runCommand, usageError } from './commands/index.ts';

const knownOptions = ['out', 'json'];

/** Runs the command the arguments name; `--out <dir>` and `--json` are the options, any other a usage error. */
async function exitOf(args: readonly string[]): Promise<Exit> {
  const { positionals, tokens, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: { out: { type: 'string' }, json: { type: 'boolean' } },
  });
  const unknown = tokens.find(
    (token) => token.kind === 'option' && !knownOptions.includes(token.name),
  );
  if (unknown !== undefined && unknown.kind === 'option') {
    return usageError(`Unknown option: ${unknown.rawName}`);
  }
  const { out, json } = values;
  if (out !== undefined && (typeof out !== 'string' || out === '')) {
    return usageError('--out takes a folder');
  }
  const output: Output = json === undefined ? 'lines' : 'json';
  const called = out === undefined ? { positionals, output } : { positionals, out, output };
  return await runCommand(called, { cwd: process.cwd(), now: Date.now(), env: process.env });
}

const exit = await exitOf(process.argv.slice(2));
for (const line of exit.stdout) {
  process.stdout.write(`${line}\n`);
}
for (const line of exit.stderr) {
  process.stderr.write(`${line}\n`);
}
process.exitCode = exit.status;
