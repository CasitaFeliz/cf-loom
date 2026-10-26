import type { ImportedDefinitions, Root, RootKind } from '@cf-loom/contract/internal';
import { configFile, defaultLayout, loadConfig, type ServiceLayout } from '../config/index.ts';
import {
  type ImportedPackage,
  type LoadedRoot,
  loadRoot,
  type PackageName,
  projectPackageOf,
  resolvePackages,
} from '../loading/index.ts';
import { type Tooling, tooling } from './failures.ts';

/** A project as `generate`, `verify` and `package` read it: where it is, its package, its Root and what the Root lists. */
export type Project = {
  readonly directory: string;
  readonly packageName: PackageName;
  /** The project's package.json as read, which a Definitions Package is published from. */
  readonly manifest: Readonly<Record<string, unknown>>;
  /**
   * Where the Service's Handlers and generated files live; for an Application or a Definitions
   * Package it holds the defaults, which are unused.
   */
  readonly layout: ServiceLayout;
  readonly root: Root;
  /** The name the Root file exports the Root under, which the Handler map imports it by. */
  readonly rootExportName: string;
  /** Everything else the Root file exports, by name, which a Definitions Package shares. */
  readonly rootExports: Readonly<Record<string, unknown>>;
  /** Where the Root file sits, relative to the project, as messages name it. */
  readonly rootFile: string;
  /** Every Definitions Package the Root's import reached, as Node resolved it, named by its package.json or not. */
  readonly packages: readonly ImportedDefinitions[];
  /** Every module of a package the Root's import reached, as Node resolved it. */
  readonly imported: readonly ImportedPackage[];
};

/** The Root a Snapshot is declared from: what a Root file exports, and the packages its import reached. */
export type DeclaredRoot = Pick<
  Project,
  'directory' | 'packageName' | 'root' | 'rootExports' | 'rootFile' | 'packages'
>;

/** A project read, or the tooling error that stopped reading it. */
export type ReadProject = { readonly kind: 'read'; readonly project: Project } | Tooling;

/**
 * Reads the project in `directory`: its package.json, its configuration, its Root and the
 * Definitions Packages its import reached, as installed; each failure is a tooling error.
 */
export async function projectOf(directory: string): Promise<ReadProject> {
  const projectPackage = projectPackageOf(directory);
  if (projectPackage.kind === 'failed') {
    return tooling(projectPackage.message);
  }
  const config = await loadConfig(directory);
  if (config.kind === 'failed') {
    return tooling(config.message);
  }
  const loaded = await loadedRootOf(directory, config.config.layout);
  if (loaded.kind === 'failed') {
    return tooling(loaded.message);
  }
  const { packageName, manifest } = projectPackage;
  const declaring = declaredRootOf(loaded, { directory, packageName });
  if (declaring.kind === 'tooling') {
    return declaring;
  }
  const { layout = defaultLayout } = config.config;
  const { imported } = loaded;
  const { rootExportName } = loaded;
  const project = { ...declaring.declared, manifest, layout, imported, rootExportName };
  return { kind: 'read', project };
}

/**
 * The Root a loaded Root file declares, with the Definitions Packages its import reached, as
 * Node resolved them; the one step from a loaded Root to a Snapshot, for a project's own Root and
 * for a staged package's.
 */
export function declaredRootOf(
  loaded: Extract<LoadedRoot, { readonly kind: 'loaded' }>,
  { directory, packageName }: Pick<Project, 'directory' | 'packageName'>,
): { readonly kind: 'declared'; readonly declared: DeclaredRoot } | Tooling {
  const resolved = resolvePackages(loaded.root, loaded.imported);
  if (resolved.kind === 'failed') {
    return tooling(resolved.message);
  }
  const { root, file: rootFile, exports: rootExports } = loaded;
  const { packages } = resolved;
  const declared = { directory, packageName, root, rootExports, rootFile, packages };
  return { kind: 'declared', declared };
}

/** The project's Root, unless its configuration sets a `layout` a Root without Handlers refuses. */
async function loadedRootOf(
  directory: string,
  layout: ServiceLayout | undefined,
): Promise<LoadedRoot> {
  const loaded = await loadRoot(directory);
  if (loaded.kind === 'failed') {
    return loaded;
  }
  const refusal = layoutRefusalOf(layout, loaded.root.kind);
  return refusal === undefined ? loaded : { kind: 'failed', message: refusal };
}

/** The line refusing a `layout` in the configuration of a Root that has no Handlers. */
function layoutRefusalOf(
  layout: ServiceLayout | undefined,
  rootKind: RootKind,
): string | undefined {
  if (layout === undefined) {
    return undefined;
  }
  switch (rootKind) {
    case 'service':
      return undefined;
    case 'application':
      return `${configFile}: an Application has no Handlers, so it takes no \`layout\``;
    case 'definitions':
      return `${configFile}: a Definitions Package has no Handlers, so it takes no \`layout\``;
  }
}
