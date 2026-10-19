import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalSnapshotOf,
  canonicalTextOf,
  type RootPackage,
  type ServiceSnapshot,
  type Snapshot,
  type SnapshotContext,
  schemaOriginsOf,
  snapshotOf,
  type ValidatedContract,
  type ValidContract,
  validateContract,
} from '@casitafeliz/loom-contract/internal';
import { oneLineOf } from '../loading/index.ts';
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
 * Which CLI the declared Snapshot names: the one running, as `generate` and `package` write it,
 * or the committed file's, as `verify` compares, so upgrading cf-loom alone never fails `verify`.
 */
export type Generator = 'running' | 'committed';

/**
 * What every command builds before it writes: the project, its valid root, the declared Snapshot
 * in canonical order and its bytes, and the committed file; or the exit that stopped building it.
 */
export type Built =
  | {
      readonly kind: 'built';
      readonly project: Project;
      readonly validated: ValidContract;
      readonly snapshot: Snapshot;
      readonly bytes: Buffer;
      readonly committed: Committed;
    }
  | Stopped;

/**
 * The stop of a command that writes from the Snapshot when the committed file is no JSON: its
 * author restores or deletes it, since its `deprecatedAt` stamps would be lost.
 */
export function noJsonExitOf(
  built: BuiltProject,
  command: 'generate' | 'package',
): Exit | undefined {
  if (built.committed.kind !== 'no-json') {
    return undefined;
  }
  const { reason } = built.committed;
  return toolingError(
    `${snapshotFile} is no JSON (${reason}): restore it or delete it, then run cf-loom ${command}`,
  );
}

/** A project as built, valid. */
export type BuiltProject = Extract<Built, { readonly kind: 'built' }>;

/** A Service's project as built, the one kind of root that offers Elements. */
export type BuiltService = BuiltProject & { readonly snapshot: ServiceSnapshot };

/** Whether a built project is a Service's. */
export function isBuiltService(built: BuiltProject): built is BuiltService {
  return built.snapshot.kind === 'service';
}

/**
 * Builds the declared Snapshot of the project where the command runs, offline, reading from the
 * committed file only the `deprecatedAt` stamps it carries forward and, for `verify`, its generator.
 */
export async function builtOf(run: Run, generator: Generator): Promise<Built> {
  const read = await projectOf(run.cwd);
  if (read.kind === 'stopped') {
    return read;
  }
  const { project } = read;
  const committed = committedOf(project.directory);
  if (committed.kind === 'stopped') {
    return committed;
  }
  const parsed = committed.kind === 'json' ? committed.parsed : undefined;
  const context: SnapshotContext = {
    generator: generatorOf(generator, parsed),
    packages: project.packages,
    committed: parsed,
    now: run.now,
  };
  const validated = validatedOf(project);
  switch (validated.kind) {
    case 'stopped':
      return validated;
    case 'invalid':
      return stopped(checkFailed(validated.failures.map(failureLine)));
    case 'valid': {
      const snapshot = canonicalSnapshotOf(snapshotOf(validated, context));
      const bytes = Buffer.from(canonicalTextOf(snapshot), 'utf8');
      return { kind: 'built', project, validated, snapshot, bytes, committed };
    }
  }
}

/** The root validated: the walk runs the user's schemas, whose getters may throw. */
function validatedOf(project: Project): ValidatedContract | Stopped {
  const { directory, packageName, root, rootExports, rootFile, packages } = project;
  const exportsByDefinitions = new Map(
    packages.map((installed) => [installed.definitions, Object.values(installed.exports)]),
  );
  const rootPackage: RootPackage = {
    originOf: schemaOriginsOf(packages),
    packageName: packageName.name,
    exportsOf: (definitions) =>
      definitions === root ? rootExports : (exportsByDefinitions.get(definitions) ?? []),
  };
  try {
    return validateContract(root, rootPackage);
  } catch (e) {
    return stopped(toolingError(`${rootFile} threw while it was read: ${oneLineOf(e, directory)}`));
  }
}

function committedOf(directory: string): Committed | Stopped {
  const path = join(directory, snapshotFile);
  if (!existsSync(path)) {
    return { kind: 'none' };
  }
  const bytes = bytesOf(path, directory);
  if (!Buffer.isBuffer(bytes)) {
    return bytes;
  }
  try {
    return { kind: 'json', bytes, parsed: JSON.parse(bytes.toString('utf8')) };
  } catch (e) {
    return { kind: 'no-json', reason: oneLineOf(e, directory) };
  }
}

function bytesOf(path: string, directory: string): Buffer | Stopped {
  try {
    return readFileSync(path);
  } catch (e) {
    return stopped(toolingError(`${snapshotFile} cannot be read: ${oneLineOf(e, directory)}`));
  }
}

/** The CLI the Snapshot names: the committed file's for `verify`, else the one running. */
function generatorOf(generator: Generator, committed: unknown): string {
  const written =
    typeof committed === 'object' && committed !== null
      ? Reflect.get(committed, 'generator')
      : undefined;
  if (generator === 'committed' && typeof written === 'string') {
    return written;
  }
  return runningGeneratorOf();
}

/** The CLI running, by its package's name and version. */
function runningGeneratorOf(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const name =
    typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'name') : undefined;
  const version =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'version')
      : undefined;
  return `${String(name)}@${String(version)}`;
}

/** A build stopped by the exit it ends with. */
export type Stopped = { readonly kind: 'stopped'; readonly exit: Exit };

/** A build stopped by the exit it ends with. */
export function stopped(exit: Exit): Stopped {
  return { kind: 'stopped', exit };
}
