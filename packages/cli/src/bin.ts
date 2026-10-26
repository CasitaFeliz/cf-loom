#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  type Called,
  crashedExitOf,
  type Exit,
  type Output,
  printerTo,
  runCommand,
  statusAfterPrinting,
  usageError,
} from './commands/index.ts';

const optionTypes = {
  out: { type: 'string' },
  prefix: { type: 'string' },
  against: { type: 'string' },
  json: { type: 'boolean' },
  force: { type: 'boolean' },
  prerelease: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} as const;
const knownOptions = Object.keys(optionTypes);
const flags = Object.entries(optionTypes)
  .filter(([, { type }]) => type === 'boolean')
  .map(([name]) => name);

/** The usage line of a string option given no value, an empty one, or another option as its value. */
const valueLines: Readonly<Record<string, string>> = {
  out: '--out takes a folder',
  against: '--against takes a version or a dist-tag',
};

/** The command the arguments name, or the usage error they are. */
type Parsed =
  | { readonly kind: 'called'; readonly called: Called }
  | { readonly kind: 'usage'; readonly exit: Exit };

type ParsedArgs = ReturnType<typeof parsedOf>;

function parsedOf(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: optionTypes,
  });
}

/** Reads the arguments; `--out <dir>`, `--prefix <p>`, `--against <version|dist-tag>`, `--json`, `--force`, `--prerelease`, `--help` and `--version` are the options, any other a usage error. */
function calledOf(args: readonly string[]): Parsed {
  const parsed = parsedOf(args);
  const broken = optionProblemIn(parsed);
  if (broken !== undefined) {
    return { kind: 'usage', exit: usageError(broken) };
  }
  const { positionals, values } = parsed;
  const { out, prefix, against, json, force, prerelease, help, version } = values;
  const output: Output = json === true ? 'json' : 'lines';
  const options = { positionals, output, force: force === true, prerelease: prerelease === true };
  const called: Called = {
    ...options,
    help: help === true,
    version: version === true,
    ...(typeof out === 'string' ? { out } : {}),
    ...(prefix === undefined ? {} : { prefix: typeof prefix === 'string' ? prefix : '' }),
    ...(typeof against === 'string' ? { against } : {}),
  };
  return { kind: 'called', called };
}

/** What is wrong with the options given, in one line, if anything is. */
function optionProblemIn({ tokens }: ParsedArgs): string | undefined {
  const unknown = tokens.find(
    (token) => token.kind === 'option' && !knownOptions.includes(token.name),
  );
  if (unknown !== undefined && unknown.kind === 'option') {
    return `Unknown option: ${unknown.rawName}`;
  }
  const lacking = tokens.find(isLackingItsValue);
  if (lacking?.kind === 'option') {
    return valueLines[lacking.name];
  }
  const valued = tokens.find(
    (token) => token.kind === 'option' && flags.includes(token.name) && token.value !== undefined,
  );
  return valued?.kind === 'option' ? `--${valued.name} takes no value` : undefined;
}

/** Whether a token is an option that takes a value and was given none, an empty one, or another option as it. */
function isLackingItsValue(token: ParsedArgs['tokens'][number]): boolean {
  if (token.kind !== 'option' || valueLines[token.name] === undefined) {
    return false;
  }
  const { value, inlineValue } = token;
  return value === undefined || value === '' || (inlineValue === false && value.startsWith('-'));
}

/** Runs the command the arguments name; a throw is a bug, and ends as a tooling error. */
async function exitOf(
  args: readonly string[],
  progress: (lines: readonly string[]) => void,
): Promise<Exit> {
  const read = calledOf(args);
  if (read.kind === 'usage') {
    return read.exit;
  }
  const { called } = read;
  try {
    const run = { cwd: process.cwd(), now: Date.now(), env: process.env, progress };
    return await runCommand(called, run);
  } catch (e) {
    return crashedExitOf(e, called.output);
  }
}

const streams = { stdout: printerTo(process.stdout), stderr: printerTo(process.stderr) };
const exit = await exitOf(process.argv.slice(2), streams.stdout.print);
streams.stdout.print(exit.stdout);
streams.stderr.print(exit.stderr);
process.exit(await statusAfterPrinting(exit.status, streams));
