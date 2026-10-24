import { join } from 'node:path';
import { isBrokerPrefix } from '@cf-loom/contract/internal';
import { isRootKind, oneLineOf } from '../loading/index.ts';
import type { Run } from '../project/index.ts';
import { asyncApiCommand } from './asyncapi.ts';
import { brokerPlanCommand } from './broker-plan.ts';
import { check, type Output } from './check.ts';
import { errorsExitOf } from './check-json.ts';
import { type Exit, toolingError } from './exit.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { openApiCommand } from './openapi.ts';
import { defaultPackageFolder, packageCommand } from './package.ts';
import { publish } from './publish.ts';
import { verify } from './verify.ts';

/** The package folder of the CLI, where its sources or its build sit, so a throw names the file in it. */
const packageRoot = join(import.meta.dirname, '..', '..');

const usage =
  'Usage: cf-loom init [service | application | definitions] | generate | verify | package [--out <dir>] | check [--json] | broker-plan [--prefix <p>] [--json] | openapi | asyncapi [--prefix <p>] | publish [--force] [--prerelease]';

/** How the CLI was called: the command and its arguments, and the options it was given. */
export type Called = {
  readonly positionals: readonly string[];
  readonly out?: string;
  readonly prefix?: string;
  readonly output: Output;
  readonly force: boolean;
  readonly prerelease: boolean;
};

/** How the CLI is called wrongly: an unknown command, kind, option or argument, with the usage. */
export function usageError(message: string): Exit {
  return toolingError(`${message}. ${usage}`);
}

/** A throw, which is a bug of cf-loom, as the tooling error that says so, in the output the command prints. */
export function crashedExitOf(thrown: unknown, output: Output): Exit {
  const exit = toolingError(`cf-loom failed: ${oneLineOf(thrown, packageRoot)}`);
  switch (output) {
    case 'lines':
      return exit;
    case 'json':
      return errorsExitOf(exit);
  }
}

/** Runs the command the arguments name where and when the CLI runs. */
export async function runCommand(called: Called, run: Run): Promise<Exit> {
  const { positionals, out, output, force, prerelease } = called;
  const [command, ...rest] = positionals;
  const misplaced = misplacedOptionIn(called, command);
  if (misplaced !== undefined) {
    return misplaced;
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
      return rest.length > 0 ? usageError('check takes no argument') : await check(run, output);
    case 'broker-plan':
      return await brokerPlanExitOf(rest, called, run);
    case 'openapi':
      return await openApiExitOf(rest, run);
    case 'asyncapi':
      return await asyncApiExitOf(rest, called, run);
    case 'publish':
      return rest.length > 0
        ? usageError('publish takes no argument')
        : await publish(run, { force, prerelease });
    default:
      return usageError(`Unknown command: ${command ?? '(none)'}`);
  }
}

/** The usage error of an option given to a command that does not take it. */
function misplacedOptionIn(
  { out, prefix, output, force, prerelease }: Called,
  command: string | undefined,
): Exit | undefined {
  if (out !== undefined && command !== 'package') {
    return usageError('Only package takes --out');
  }
  if (prefix !== undefined && command !== 'broker-plan' && command !== 'asyncapi') {
    return usageError('Only broker-plan and asyncapi take --prefix');
  }
  if (output === 'json' && command !== 'check' && command !== 'broker-plan') {
    return usageError('Only check and broker-plan take --json');
  }
  if (force && command !== 'publish') {
    return usageError('Only publish takes --force');
  }
  if (prerelease && command !== 'publish') {
    return usageError('Only publish takes --prerelease');
  }
  return undefined;
}

async function brokerPlanExitOf(
  rest: readonly string[],
  { prefix, output }: Called,
  run: Run,
): Promise<Exit> {
  if (rest.length > 0) {
    return usageError('broker-plan takes no argument');
  }
  return invalidPrefixExitOf(prefix) ?? (await brokerPlanCommand(run, prefix ?? null, output));
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
    ? usageError('--prefix takes a prefix in kebab-case, such as staging')
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
