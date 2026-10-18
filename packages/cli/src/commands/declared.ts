import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalTextOf,
  type SnapshotContext,
  schemaOriginsOf,
  snapshotOf,
  type ValidatedContract,
  validateContract,
} from '@casitafeliz/loom-contract/internal';
import { thrownLineOf } from '../loading/index.ts';
import { checkFailed, type Exit, failureLine, type Run, toolingError } from './exit.ts';
import { type Project, projectOf } from './project.ts';

/** The file `generate` writes the declared Snapshot to, next to `cf-loom.config.ts`. */
export const snapshotFile = 'contract.snapshot.json';

/** The committed `contract.snapshot.json` as read: none, its bytes and their JSON, or no JSON. */
export type Committed =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly bytes: Buffer; readonly parsed: unknown }
  | { readonly kind: 'no-json'; readonly reason: string };

/**
 * Which CLI the declared Snapshot names: the one running, as `generate` writes it, or the
 * committed file's, as `verify` compares, so upgrading cf-loom alone never fails `verify`.
 */
export type Generator = 'running' | 'committed';

/** The declared Snapshot's bytes and the committed file, or the exit that stopped building it. */
export type Declared =
  | { readonly kind: 'built'; readonly bytes: Buffer; readonly committed: Committed }
  | { readonly kind: 'stopped'; readonly exit: Exit };

/**
 * Builds the declared Snapshot of the project where the command runs, offline, reading from the
 * committed file only the `deprecatedAt` stamps it carries forward and, for `verify`, its generator.
 */
export async function declaredSnapshotOf(run: Run, generator: Generator): Promise<Declared> {
  const read = await projectOf(run.cwd);
  if (read.kind === 'stopped') {
    return read;
  }
  const committed = committedOf(run.cwd);
  if (committed.kind === 'stopped') {
    return committed;
  }
  const parsed = committed.kind === 'json' ? committed.parsed : undefined;
  const context = { generator: generatorOf(generator, parsed), committed: parsed, now: run.now };
  const built = builtOf(read.project, { context, cwd: run.cwd });
  return built.kind === 'stopped' ? built : { ...built, committed };
}

/** Validates the root and builds its Snapshot. */
function builtOf(
  project: Project,
  { context, cwd }: { readonly context: Omit<SnapshotContext, 'packages'>; readonly cwd: string },
): { readonly kind: 'built'; readonly bytes: Buffer } | Stopped {
  const validated = validatedOf(project, cwd);
  if (validated.kind === 'stopped') {
    return validated;
  }
  if (validated.validated.kind === 'invalid') {
    return stopped(checkFailed(validated.validated.failures.map(failureLine)));
  }
  const snapshot = snapshotOf(validated.validated, { ...context, packages: project.packages });
  return { kind: 'built', bytes: Buffer.from(canonicalTextOf(snapshot), 'utf8') };
}

/** The root validated: the walk runs the user's schemas, whose getters may throw. */
function validatedOf(
  { packageName, root, rootFile, packages }: Project,
  cwd: string,
): { readonly kind: 'validated'; readonly validated: ValidatedContract } | Stopped {
  const originOf = schemaOriginsOf(packages);
  try {
    const validated = validateContract(root, { originOf, packageName: packageName.name });
    return { kind: 'validated', validated };
  } catch (e) {
    return stopped(toolingError(`${rootFile} threw while it was read: ${thrownLineOf(e, cwd)}`));
  }
}

function committedOf(cwd: string): Committed | Stopped {
  const path = join(cwd, snapshotFile);
  if (!existsSync(path)) {
    return { kind: 'none' };
  }
  const bytes = bytesOf(path, cwd);
  if (!Buffer.isBuffer(bytes)) {
    return bytes;
  }
  try {
    return { kind: 'json', bytes, parsed: JSON.parse(bytes.toString('utf8')) };
  } catch (e) {
    return { kind: 'no-json', reason: thrownLineOf(e, cwd) };
  }
}

function bytesOf(path: string, cwd: string): Buffer | Stopped {
  try {
    return readFileSync(path);
  } catch (e) {
    return stopped(toolingError(`${snapshotFile} cannot be read: ${thrownLineOf(e, cwd)}`));
  }
}

/** The CLI the Snapshot names, by its package's name and version. */
function generatorOf(generator: Generator, committed: unknown): string {
  const written =
    typeof committed === 'object' && committed !== null
      ? Reflect.get(committed, 'generator')
      : undefined;
  if (generator === 'committed' && typeof written === 'string') {
    return written;
  }
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return `${manifest.name}@${manifest.version}`;
}

type Stopped = Extract<Declared, { readonly kind: 'stopped' }>;

function stopped(exit: Exit): Stopped {
  return { kind: 'stopped', exit };
}
