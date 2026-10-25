import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
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
} from '@cf-loom/contract/internal';
import { oneLineOf, packageJsonNameOf } from '../loading/index.ts';
import { type Committed, committedOf } from './committed.ts';
import { type ProjectFailure, type Tooling, tooling } from './failures.ts';
import { type Project, projectOf } from './project.ts';
import type { Run } from './run.ts';

/**
 * Which CLI the declared Snapshot names: the one running, as `generate` writes it, or the
 * committed file's, as `verify` and `package` compare it, so upgrading cf-loom alone fails
 * neither.
 */
export type Generator = 'running' | 'committed';

/**
 * What every command builds before it writes: the project, its valid root, the declared Snapshot
 * in canonical order with its text and bytes, and the committed file; or why it could not be built.
 */
export type Built =
  | {
      readonly kind: 'built';
      readonly project: Project;
      readonly validated: ValidContract;
      readonly snapshot: Snapshot;
      readonly text: string;
      readonly bytes: Buffer;
      readonly committed: Committed;
    }
  | ProjectFailure;

/** A project as built, valid. */
export type BuiltProject = Extract<Built, { readonly kind: 'built' }>;

/** A Service's project as built, the one kind of root that offers Elements. */
export type BuiltService = BuiltProject & { readonly snapshot: ServiceSnapshot };

/** Whether the committed `contract.snapshot.json` is what `generate` would write, its generator aside. */
export function isCommittedCurrent(built: BuiltProject): boolean {
  return built.committed.kind === 'json' && built.committed.bytes.equals(built.bytes);
}

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
  if (read.kind === 'tooling') {
    return read;
  }
  const { project } = read;
  const committed = committedOf(project.directory);
  if (committed.kind === 'tooling') {
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
    case 'tooling':
    case 'invalid':
      return validated;
    case 'valid': {
      const snapshot = canonicalSnapshotOf(snapshotOf(validated, context));
      const text = canonicalTextOf(snapshot);
      const bytes = Buffer.from(text, 'utf8');
      return { kind: 'built', project, validated, snapshot, text, bytes, committed };
    }
  }
}

/** The root validated: the walk runs the user's schemas, whose getters may throw. */
function validatedOf(project: Project): ValidatedContract | Tooling {
  const { directory, packageName, root, rootExports, rootFile, packages } = project;
  const exportsByDefinitions = new Map(
    packages.map((resolved) => [resolved.definitions, resolved.exports]),
  );
  const rootPackage: RootPackage = {
    originOf: schemaOriginsOf(packages),
    packageName: packageJsonNameOf(packageName),
    packages: project.definitionsPackages,
    exportsOf: (definitions) =>
      definitions === root ? rootExports : (exportsByDefinitions.get(definitions) ?? {}),
  };
  try {
    return validateContract(root, rootPackage);
  } catch (e) {
    return tooling(`${rootFile} threw while it was read: ${oneLineOf(e, directory)}`);
  }
}

/** The CLI the Snapshot names: the committed file's for `verify` and `package`, else the one running. */
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
