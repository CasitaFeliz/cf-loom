import { Buffer } from 'node:buffer';
import {
  canonicalSnapshotOf,
  canonicalTextOf,
  nestingFailureOf,
  type RootPackage,
  type ServiceSnapshot,
  type Snapshot,
  snapshotOf,
  type ValidatedRoot,
  type ValidRoot,
  validateRoot,
} from '@cf-loom/contract/internal';
import { oneLineOf, packageJsonNameOf } from '../loading/index.ts';
import { type FileComparison, fileComparisonOf } from '../writing/index.ts';
import { type Committed, committedOf } from './committed.ts';
import { fileOfIn } from './failure-files.ts';
import { type Invalid, invalid, type ProjectFailure, type Tooling, tooling } from './failures.ts';
import { type DeclaredRoot, type Project, projectOf } from './project.ts';
import type { Run } from './run.ts';

/**
 * What every command builds before it writes: the project, its valid Root, the declared Snapshot
 * in canonical order with its text and bytes, and the committed file; or why it could not be built.
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
 * Builds the declared Snapshot of the project where the command runs, offline, from its source and
 * its installed packages alone; the committed file is read only for its bytes and its format.
 */
export async function builtOf(run: Run): Promise<Built> {
  const read = await projectOf(run.cwd);
  if (read.kind === 'tooling') {
    return read;
  }
  const { project } = read;
  const committed = committedOf(project.directory);
  if (committed.kind === 'tooling') {
    return committed;
  }
  const declared = declaredOf(project);
  if (declared.kind === 'invalid') {
    return { ...declared, fileOf: await fileOfIn(project) };
  }
  if (declared.kind !== 'declared') {
    return declared;
  }
  const { validated, snapshot, text, bytes } = declared;
  return { kind: 'built', project, validated, snapshot, text, bytes, committed };
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
export function declaredOf(declaring: DeclaredRoot): Declared {
  const validated = validatedOf(declaring);
  switch (validated.kind) {
    case 'tooling':
      return validated;
    case 'invalid':
      return invalid(validated.failures);
    case 'valid': {
      const snapshot = canonicalSnapshotOf(snapshotOf(validated));
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
  return failure === undefined ? undefined : invalid([failure]);
}

/** The Root validated: the walk runs the user's schemas, whose getters may throw. */
function validatedOf(declaring: DeclaredRoot): ValidatedRoot | Tooling {
  const { directory, packageName, root, rootExports, rootFile } = declaring;
  const { packages, contractPackages } = declaring;
  const rootPackage: RootPackage = {
    packageName: packageJsonNameOf(packageName),
    packages,
    contractPackages,
    rootExports,
  };
  try {
    return validateRoot(root, rootPackage);
  } catch (e) {
    return tooling(`${rootFile} threw while it was read: ${oneLineOf(e, directory)}`);
  }
}
