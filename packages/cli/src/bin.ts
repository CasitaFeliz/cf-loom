#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  type Called,
  crashedExitOf,
  type Exit,
  type Output,
  runCommand,
  usageError,
} from './commands/index.ts';

const knownOptions = ['out', 'json'];

/** The command the arguments name, or the usage error they are. */
type Parsed =
  | { readonly kind: 'called'; readonly called: Called }
  | { readonly kind: 'usage'; readonly exit: Exit };

/** Reads the arguments; `--out <dir>` and `--json` are the options, any other a usage error. */
function parsed(args: readonly string[]): Parsed {
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
    return { kind: 'usage', exit: usageError(`Unknown option: ${unknown.rawName}`) };
  }
  const { out, json } = values;
  if (out !== undefined && (typeof out !== 'string' || out === '')) {
    return { kind: 'usage', exit: usageError('--out takes a folder') };
  }
  if (json !== undefined && json !== true) {
    return { kind: 'usage', exit: usageError('--json takes no value') };
  }
  const output: Output = json === true ? 'json' : 'lines';
  const called = out === undefined ? { positionals, output } : { positionals, out, output };
  return { kind: 'called', called };
}

/** Runs the command the arguments name; a throw is a bug, and ends as a tooling error. */
async function exitOf(args: readonly string[]): Promise<Exit> {
  const read = parsed(args);
  if (read.kind === 'usage') {
    return read.exit;
  }
  const { called } = read;
  try {
    return await runCommand(called, { cwd: process.cwd(), now: Date.now(), env: process.env });
  } catch (e) {
    return crashedExitOf(e, called.output);
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
