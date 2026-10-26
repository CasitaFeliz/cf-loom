import type { Built } from '../building/index.ts';
import { failed } from '../child-process/index.ts';
import { type InstalledPackage, installedRootOf } from '../loading/index.ts';
import {
  type BuiltProject,
  declaredOf,
  declaredRootOf,
  type Project,
  snapshotFile,
} from '../project/index.ts';

/** A Definitions Package staged as an installed one, and the declared Snapshot its built entry must have. */
export type EntryToCheck = {
  readonly project: Pick<Project, 'packageName'>;
  readonly staged: InstalledPackage;
  readonly declared: Pick<BuiltProject, 'text' | 'context'>;
};

/**
 * Imports a staged Definitions Package as a Service that installed it imports it, and requires
 * the Snapshot its built entry declares to be the committed one, so a build that is stale, or
 * that no Service could import, is never published.
 */
export async function checkedEntryOf({ project, staged, declared }: EntryToCheck): Promise<Built> {
  const { packageName } = staged;
  const loaded = await installedRootOf(staged);
  if (loaded.kind === 'failed') {
    return notImportable(packageName, loaded.message);
  }
  const directory = staged.staging;
  const root = declaredRootOf(loaded, { directory, packageName: project.packageName });
  if (root.kind === 'tooling') {
    return notImportable(packageName, root.message);
  }
  const entry = declaredOf(root.declared, declared.context);
  switch (entry.kind) {
    case 'tooling':
      return notImportable(packageName, entry.message);
    case 'invalid':
      return stale(packageName);
    case 'declared':
      return entry.text === declared.text ? { kind: 'built' } : stale(packageName);
  }
}

function notImportable(name: string, reason: string): Built {
  return failed(`${name} cannot be imported as installed: ${reason}: build, then publish`);
}

function stale(name: string): Built {
  const line = `${name}'s built files are not what ${snapshotFile} describes: build, then publish`;
  return failed(line);
}
