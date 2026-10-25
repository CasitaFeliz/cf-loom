import type { ResolvedDefinitions, UnidentifiedDefinitions } from '@cf-loom/contract/internal';
import { configFile, defaultLayout, loadConfig, type ServiceLayout } from '../config/index.ts';
import {
  type ImportedPackage,
  type LoadedRoot,
  loadRoot,
  type PackageName,
  projectPackageOf,
  type RootKind,
  resolvePackages,
} from '../loading/index.ts';
import { type Tooling, tooling } from './failures.ts';

/** A project as `generate`, `verify` and `package` read it: where it is, its package, its root and what the root lists. */
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
  readonly root: unknown;
  /** Everything else the root file exports, by name, which a Definitions root shares. */
  readonly rootExports: Readonly<Record<string, unknown>>;
  /** Where the root file sits, relative to the project, as messages name it. */
  readonly rootFile: string;
  /** Every Definitions Package the root's import reached, as Node resolved it. */
  readonly packages: readonly ResolvedDefinitions[];
  /** Every imported package exporting a Definitions object whose package.json cannot name it. */
  readonly unidentified: readonly UnidentifiedDefinitions[];
  /** Every module of a package the root's import reached, as Node resolved it. */
  readonly imported: readonly ImportedPackage[];
};

/** A project read, or the tooling error that stopped reading it. */
export type ReadProject = { readonly kind: 'read'; readonly project: Project } | Tooling;

/**
 * Reads the project in `directory`: its package.json, its configuration, its root and the
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
  const resolved = resolvePackages(loaded.root, loaded.imported);
  if (resolved.kind === 'failed') {
    return tooling(resolved.message);
  }
  const { packageName, manifest } = projectPackage;
  const { root, file: rootFile, exports: rootExports, imported } = loaded;
  const { layout = defaultLayout } = config.config;
  const { packages, unidentified } = resolved;
  const project = {
    directory,
    packageName,
    manifest,
    layout,
    root,
    rootExports,
    rootFile,
    packages,
    unidentified,
    imported,
  };
  return { kind: 'read', project };
}

/** The project's root, unless its configuration sets a `layout` a root without Handlers refuses. */
async function loadedRootOf(
  directory: string,
  layout: ServiceLayout | undefined,
): Promise<LoadedRoot> {
  const loaded = await loadRoot(directory);
  if (loaded.kind === 'failed') {
    return loaded;
  }
  const refusal = layoutRefusalOf(layout, loaded.rootKind);
  return refusal === undefined ? loaded : { kind: 'failed', message: refusal };
}

/** The line refusing a `layout` in the configuration of a root that has no Handlers. */
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
