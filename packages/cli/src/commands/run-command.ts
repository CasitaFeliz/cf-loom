import { join } from 'node:path';
import { brokerPrefixRule, isBrokerPrefix } from '@cf-loom/contract/internal';
import { isRootKind, oneLineOf } from '../loading/index.ts';
import { asyncApiCommand } from './asyncapi.ts';
import { brokerPlanCommand } from './broker-plan.ts';
import { check } from './check.ts';
import { type Exit, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { openApiCommand } from './openapi.ts';
import type { Output } from './output.ts';
import { defaultPackageFolder, packageCommand } from './package.ts';
import { publish } from './publish.ts';
import type { Run } from './run.ts';
import { helpExitOf, usageError, versionExit } from './usage.ts';
import { verify } from './verify.ts';

/** The package folder of the CLI, where its sources or its build sit, so a throw names the file in it. */
const packageRoot = join(import.meta.dirname, '..', '..');

/** How the CLI was called: the command and its arguments, and the options it was given. */
export type Called = {
  readonly positionals: readonly string[];
  readonly out?: string;
  readonly prefix?: string;
  readonly against?: string;
  readonly output: Output;
  readonly force: boolean;
  readonly prerelease: boolean;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly version: boolean;
};

/** A throw, which is a bug of cf-loom, as the tooling error that says so. */
export function crashedExitOf(thrown: unknown): Exit {
  return toolingError(`cf-loom failed: ${oneLineOf(thrown, packageRoot)}`);
}

/** Runs the command the arguments name where and when the CLI runs. */
export async function runCommand(called: Called, run: Run): Promise<Exit> {
  const { positionals, out, force, prerelease, dryRun } = called;
  const [command, ...rest] = positionals;
  const answered = misplacedOptionIn(called, command) ?? askedAboutOf(called);
  if (answered !== undefined) {
    return answered;
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
      return await checkExitOf(rest, called, run);
    case 'broker-plan':
      return await brokerPlanExitOf(rest, called, run);
    case 'openapi':
      return await openApiExitOf(rest, run);
    case 'asyncapi':
      return await asyncApiExitOf(rest, called, run);
    case 'publish':
      return rest.length > 0
        ? usageError('publish takes no argument')
        : await publish(run, { force, prerelease, dryRun });
    default:
      return usageError(`Unknown command: ${command ?? '(none)'}`);
  }
}

/** The answer to `--help`, `help` and `--version`, which come before any command runs. */
function askedAboutOf({ help, version, positionals }: Called): Exit | undefined {
  const [command, ...rest] = positionals;
  if (help || command === 'help') {
    return helpExitOf(command === 'help' ? rest : positionals);
  }
  return version ? versionExit() : undefined;
}

/** The usage error of an option given to a command that does not take it. */
function misplacedOptionIn(
  { out, prefix, against, force, prerelease, dryRun }: Called,
  command: string | undefined,
): Exit | undefined {
  if (out !== undefined && command !== 'package') {
    return usageError('Only package takes --out');
  }
  if (against !== undefined && command !== 'check') {
    return usageError('Only check takes --against');
  }
  if (prefix !== undefined && command !== 'broker-plan' && command !== 'asyncapi') {
    return usageError('Only broker-plan and asyncapi take --prefix');
  }
  if (dryRun && command !== 'publish') {
    return usageError('Only publish takes --dry-run');
  }
  if (force && command !== 'publish') {
    return usageError('Only publish takes --force');
  }
  if (prerelease && command !== 'publish' && command !== 'check') {
    return usageError('Only check and publish take --prerelease');
  }
  return undefined;
}

async function checkExitOf(
  rest: readonly string[],
  { against, prerelease }: Called,
  run: Run,
): Promise<Exit> {
  return rest.length > 0
    ? usageError('check takes no argument')
    : await check(run, { against, prerelease });
}

async function brokerPlanExitOf(
  rest: readonly string[],
  { prefix }: Called,
  run: Run,
): Promise<Exit> {
  if (rest.length > 0) {
    return usageError('broker-plan takes no argument');
  }
  return invalidPrefixExitOf(prefix) ?? (await brokerPlanCommand(run, prefix ?? null));
}

async function asyncApiExitOf(
  rest: readonly string[],
  { prefix }: Called,
  run: Run,
): Promise<Exit> {
  if (rest.length > 0) {
    return usageError('asyncapi takes no argument');
  }
  return invalidPrefixExitOf(prefix) ?? (await asyncApiCommand(run, prefix ?? null));
}

/** The usage error of a prefix a Broker's names cannot carry, if it is one. */
function invalidPrefixExitOf(prefix: string | undefined): Exit | undefined {
  return prefix !== undefined && !isBrokerPrefix(prefix)
    ? usageError(`--prefix takes a prefix in ${brokerPrefixRule}`)
    : undefined;
}

async function openApiExitOf(rest: readonly string[], run: Run): Promise<Exit> {
  return rest.length > 0 ? usageError('openapi takes no argument') : await openApiCommand(run);
}

function initOf(rest: readonly string[], run: Run): Exit {
  const [kind = 'service', ...more] = rest;
  if (more.length > 0) {
    return usageError('init takes one kind');
  }
  return isRootKind(kind) ? init(run, kind) : usageError(`Unknown kind: ${kind}`);
}
