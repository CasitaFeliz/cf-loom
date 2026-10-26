import { Buffer } from 'node:buffer';
import {
  canonicalSnapshotOf,
  canonicalTextOf,
  nestingFailureOf,
  type RootPackage,
  type ServiceSnapshot,
  type Snapshot,
  type SnapshotContext,
  snapshotOf,
  type ValidatedRoot,
  type ValidRoot,
  validateRoot,
} from '@cf-loom/contract/internal';
import { oneLineOf, packageJsonNameOf } from '../loading/index.ts';
import { type FileComparison, fileComparisonOf } from '../writing/index.ts';
import { type Committed, committedOf } from './committed.ts';
import { type Invalid, type ProjectFailure, type Tooling, tooling } from './failures.ts';
import { runningGeneratorOf } from './generator.ts';
import { type DeclaredRoot, type Project, projectOf } from './project.ts';
import type { Run } from './run.ts';

/**
 * Which CLI the declared Snapshot names: the one running, as `generate` writes it, or the
 * committed file's, as `verify` and `package` compare it, so upgrading cf-loom alone fails
 * neither.
 */
export type Generator = 'running' | 'committed';

/**
 * What every command builds before it writes: the project, its valid Root, the declared Snapshot
 * in canonical order with its text and bytes, the committed file and the context the Snapshot was
 * declared in; or why it could not be built.
 */
export type Built =
  | {
      readonly kind: 'built';
      readonly project: Project;
      readonly validated: ValidRoot;
      readonly snapshot: Snapshot;
      readonly text: string;
      readonly bytes: Buffer;
      readonly committed: Committed;
      readonly context: SnapshotContext;
    }
  | ProjectFailure;

/** A project as built, valid. */
export type BuiltProject = Extract<Built, { readonly kind: 'built' }>;

/** A Service's project as built, the one kind of Root that offers Elements. */
export type BuiltService = BuiltProject & { readonly snapshot: ServiceSnapshot };

/** How the committed `contract.snapshot.json` differs from what `generate` would write; a file that is missing or no JSON differs. */
export function committedComparisonOf(built: BuiltProject): FileComparison {
  const { committed } = built;
  return committed.kind === 'json' ? fileComparisonOf(built.bytes, committed.bytes) : 'different';
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
    committed: parsed,
    now: run.now,
  };
  const declared = declaredOf(project, context);
  if (declared.kind !== 'declared') {
    return declared;
  }
  const { validated, snapshot, text, bytes } = declared;
  return { kind: 'built', project, validated, snapshot, text, bytes, committed, context };
}

/** A Root's declared Snapshot in canonical order with its text and bytes, or why the Root declares none. */
export type Declared =
  | {
      readonly kind: 'declared';
      readonly validated: ValidRoot;
      readonly snapshot: Snapshot;
      readonly text: string;
      readonly bytes: Buffer;
    }
  | ProjectFailure;

/**
 * Validates a Root and declares its Snapshot in canonical order, the one way every Snapshot is
 * declared; a Snapshot nested deeper than a Snapshot may be breaks the Contract's rules.
 */
export function declaredOf(declaring: DeclaredRoot, context: SnapshotContext): Declared {
  const validated = validatedOf(declaring);
  switch (validated.kind) {
    case 'tooling':
    case 'invalid':
      return validated;
    case 'valid': {
      const snapshot = canonicalSnapshotOf(snapshotOf(validated, context));
      const tooDeep = tooDeepOf(snapshot);
      if (tooDeep !== undefined) {
        return tooDeep;
      }
      const text = canonicalTextOf(snapshot);
      return { kind: 'declared', validated, snapshot, text, bytes: Buffer.from(text, 'utf8') };
    }
  }
}

/** A Snapshot nested deeper than the decoder reads back, as a broken rule at its deepest path. */
function tooDeepOf(snapshot: Snapshot): Invalid | undefined {
  const failure = nestingFailureOf(snapshot);
  return failure === undefined ? undefined : { kind: 'invalid', failures: [failure] };
}

/** The Root validated: the walk runs the user's schemas, whose getters may throw. */
function validatedOf(declaring: DeclaredRoot): ValidatedRoot | Tooling {
  const { directory, packageName, root, rootExports, rootFile, packages } = declaring;
  const rootPackage: RootPackage = {
    packageName: packageJsonNameOf(packageName),
    packages,
    rootExports,
  };
  try {
    return validateRoot(root, rootPackage);
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
