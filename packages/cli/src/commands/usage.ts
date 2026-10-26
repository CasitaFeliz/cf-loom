import { writtenSnapshotFormat } from '@cf-loom/contract/internal';
import { runningCliOf } from '../project/index.ts';
import { done, type Exit, toolingError } from './exit.ts';

/** Each command of the CLI as its usage line writes it, in the order the usage lists them. */
const syntaxes = {
  init: 'init [service | application | definitions]',
  generate: 'generate',
  verify: 'verify',
  package: 'package [--out <dir>]',
  check: 'check [--json] [--prerelease] [--against <version|dist-tag>]',
  'broker-plan': 'broker-plan [--prefix <p>] [--json]',
  openapi: 'openapi',
  asyncapi: 'asyncapi [--prefix <p>]',
  publish: 'publish [--json] [--dry-run] [--force] [--prerelease]',
} as const;

type CommandName = keyof typeof syntaxes;

function isCommandName(word: string): word is CommandName {
  return Object.hasOwn(syntaxes, word);
}

const usage = `Usage: cf-loom ${Object.values(syntaxes).join(' | ')}`;

/** How the CLI is called wrongly: an unknown command, kind, option or argument, with the usage. */
export function usageError(message: string): Exit {
  return toolingError(`${message}. ${usage}`);
}

/** What `--help`, `-h` and `help` print: the usage of the CLI, or of the one command they are asked about. */
export function helpExitOf(topic: readonly string[]): Exit {
  const [command, ...more] = topic;
  if (command === undefined) {
    return done([usage]);
  }
  if (more.length > 0) {
    return usageError('help takes one command');
  }
  return isCommandName(command)
    ? done([`Usage: cf-loom ${syntaxes[command]}`])
    : usageError(`Unknown command: ${command}`);
}

/** What `--version` prints: the CLI's version and the Snapshot format it writes. */
export function versionExit(): Exit {
  const { name, version } = runningCliOf();
  return done([`${name} ${version} (Snapshot format ${writtenSnapshotFormat})`]);
}
