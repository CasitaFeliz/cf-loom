import type { Built } from '../building/index.ts';
import { failed } from '../child-process/index.ts';
import { installedRootOf, publishedNameOf, resolvePackages } from '../loading/index.ts';
import { type BuiltProject, declaredOf, type Project, snapshotFile } from '../project/index.ts';

/** A Definitions Package staged under `staging`, and the declared Snapshot its built entry must have. */
export type EntryToCheck = {
  readonly project: Project;
  readonly staging: string;
  readonly declared: Pick<BuiltProject, 'text' | 'context'>;
};

/**
 * Imports a staged Definitions Package as a Service that installed it imports it, and requires
 * the Snapshot its built entry declares to be the committed one, so a build that is stale, or
 * that no Service could import, is never published.
 */
export async function checkedEntryOf({ project, staging, declared }: EntryToCheck): Promise<Built> {
  const name = publishedNameOf(project.packageName, 'definitions');
  const loaded = await installedRootOf(staging, name);
  if (loaded.kind === 'failed') {
    return notImportable(name, loaded.message);
  }
  const resolved = resolvePackages(loaded.root, loaded.imported);
  if (resolved.kind === 'failed') {
    return notImportable(name, resolved.message);
  }
  const { root, file: rootFile, exports: rootExports } = loaded;
  const { packageName } = project;
  const entry = { directory: staging, packageName, root, rootExports, rootFile };
  const staged = declaredOf({ ...entry, packages: resolved.packages }, declared.context);
  switch (staged.kind) {
    case 'tooling':
      return notImportable(name, staged.message);
    case 'invalid':
      return stale(name);
    case 'declared':
      return staged.text === declared.text ? { kind: 'built' } : stale(name);
  }
}

function notImportable(name: string, reason: string): Built {
  return failed(`${name} cannot be imported as installed: ${reason}: build, then publish`);
}

function stale(name: string): Built {
  const line = `${name}'s built files are not what ${snapshotFile} describes: build, then publish`;
  return failed(line);
}
