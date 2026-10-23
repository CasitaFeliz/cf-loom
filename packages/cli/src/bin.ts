#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  type Called,
  crashedExitOf,
  type Exit,
  type Output,
  printedLineOf,
  runCommand,
  usageError,
} from './commands/index.ts';

const optionTypes = {
  out: { type: 'string' },
  prefix: { type: 'string' },
  json: { type: 'boolean' },
  force: { type: 'boolean' },
  prerelease: { type: 'boolean' },
} as const;
const knownOptions = Object.keys(optionTypes);
const flags = ['json', 'force', 'prerelease'];

/** The command the arguments name, or the usage error they are. */
type Parsed =
  | { readonly kind: 'called'; readonly called: Called }
  | { readonly kind: 'usage'; readonly exit: Exit };

/** Reads the arguments; `--out <dir>`, `--prefix <p>`, `--json`, `--force` and `--prerelease` are the options, any other a usage error. */
function calledOf(args: readonly string[]): Parsed {
  const { positionals, tokens, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: optionTypes,
  });
  const unknown = tokens.find(
    (token) => token.kind === 'option' && !knownOptions.includes(token.name),
  );
  if (unknown !== undefined && unknown.kind === 'option') {
    return { kind: 'usage', exit: usageError(`Unknown option: ${unknown.rawName}`) };
  }
  const { out, prefix, json, force, prerelease } = values;
  if (out !== undefined && (typeof out !== 'string' || out === '')) {
    return { kind: 'usage', exit: usageError('--out takes a folder') };
  }
  type Token = (typeof tokens)[number];
  const isValuedFlag = (token: Token): token is Extract<Token, { kind: 'option' }> =>
    token.kind === 'option' && flags.includes(token.name) && token.value !== undefined;
  const valued = tokens.find(isValuedFlag);
  if (valued !== undefined) {
    return { kind: 'usage', exit: usageError(`--${valued.name} takes no value`) };
  }
  const output: Output = json === true ? 'json' : 'lines';
  const options = { positionals, output, force: force === true, prerelease: prerelease === true };
  const called: Called = {
    ...options,
    ...(out === undefined ? {} : { out }),
    ...(prefix === undefined ? {} : { prefix: typeof prefix === 'string' ? prefix : '' }),
  };
  return { kind: 'called', called };
}

/** Runs the command the arguments name; a throw is a bug, and ends as a tooling error. */
async function exitOf(args: readonly string[]): Promise<Exit> {
  const read = calledOf(args);
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

/** Writes each line to a stream, through the one guard that keeps a line break out of a line. */
function print(stream: NodeJS.WriteStream, lines: readonly string[]): void {
  for (const line of lines) {
    stream.write(`${printedLineOf(line)}\n`);
  }
}

const exit = await exitOf(process.argv.slice(2));
print(process.stdout, exit.stdout);
print(process.stderr, exit.stderr);
process.exitCode = exit.status;
