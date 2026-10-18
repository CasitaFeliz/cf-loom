import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalBytes,
  type ResolvedDefinitions,
  schemaOriginsOf,
  snapshotOf,
  validateContract,
} from '@casitafeliz/loom-contract/internal';
import { loadConfig } from '../config/index.ts';
import { loadRoot, resolvePackages } from '../loading/index.ts';
import { checkFailed, type Exit, failureLine, type Run, toolingError } from './exit.ts';

/** The file `generate` writes the declared Snapshot to, next to `cf-loom.config.ts`. */
export const snapshotFile = 'contract.snapshot.json';

/** The declared Snapshot's bytes and the committed file's, or the exit that stopped building it. */
export type Declared =
  | {
      readonly kind: 'built';
      readonly bytes: Uint8Array;
      readonly committed: Uint8Array | undefined;
    }
  | { readonly kind: 'stopped'; readonly exit: Exit };

/** A project's root and the Definitions Packages it lists, as installed. */
type Project = { readonly root: unknown; readonly packages: readonly ResolvedDefinitions[] };

/** The committed Snapshot as read: its bytes and their JSON, or nothing when none is committed. */
type Committed = { readonly bytes: Uint8Array | undefined; readonly parsed: unknown };

/**
 * Builds the declared Snapshot of the project where the command runs, offline, reading from the
 * committed file only the `deprecatedAt` stamps it carries forward.
 */
export async function declaredSnapshotOf(run: Run): Promise<Declared> {
  const project = await projectOf(run.cwd);
  if (project.kind === 'stopped') {
    return project;
  }
  const { root, packages } = project.project;
  const validated = validateContract(root, schemaOriginsOf(packages));
  if (validated.kind === 'invalid') {
    return stopped(checkFailed(validated.failures.map(failureLine)));
  }
  const committed = committedOf(run.cwd);
  if (committed.kind === 'stopped') {
    return committed;
  }
  const { bytes, parsed } = committed.committed;
  const context = { generator: generatorOf(), packages, committed: parsed, now: run.now };
  return { kind: 'built', bytes: canonicalBytes(snapshotOf(validated, context)), committed: bytes };
}

async function projectOf(
  cwd: string,
): Promise<{ readonly kind: 'loaded'; readonly project: Project } | Stopped> {
  const config = await loadConfig(cwd);
  if (config.kind === 'failed') {
    return stopped(toolingError(config.message));
  }
  const loaded = await loadRoot(cwd);
  if (loaded.kind === 'failed') {
    return stopped(toolingError(loaded.message));
  }
  const resolved = resolvePackages(loaded.root, { directory: cwd, scope: config.config.scope });
  if (resolved.kind === 'failed') {
    return stopped(toolingError(resolved.message));
  }
  return { kind: 'loaded', project: { root: loaded.root, packages: resolved.packages } };
}

function committedOf(
  cwd: string,
): { readonly kind: 'read'; readonly committed: Committed } | Stopped {
  const path = join(cwd, snapshotFile);
  if (!existsSync(path)) {
    return { kind: 'read', committed: { bytes: undefined, parsed: undefined } };
  }
  const bytes = readFileSync(path);
  try {
    return { kind: 'read', committed: { bytes, parsed: JSON.parse(bytes.toString('utf8')) } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return stopped(toolingError(`${snapshotFile} is no JSON: ${reason}`));
  }
}

/** The cf-loom CLI writing the Snapshot, by its package's name and version. */
function generatorOf(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return `${manifest.name}@${manifest.version}`;
}

type Stopped = Extract<Declared, { readonly kind: 'stopped' }>;

function stopped(exit: Exit): Stopped {
  return { kind: 'stopped', exit };
}
