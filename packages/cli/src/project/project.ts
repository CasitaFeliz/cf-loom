import type { ResolvedDefinitions } from '@cf-loom/contract/internal';
import { configFile, defaultLayout, loadConfig, type ServiceLayout } from '../config/index.ts';
import {
  definitionsPackagesOf,
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
  /** The npm scope of the configuration, which the Contract Package is published under. */
  readonly scope: string;
  /**
   * Where the Service's Handlers and generated files live; for an Application or a Definitions
   * Package it holds the defaults, which are unused.
   */
  readonly layout: ServiceLayout;
  readonly root: unknown;
  /** Everything the root file exports, which a Definitions root lists. */
  readonly rootExports: readonly unknown[];
  /** Where the root file sits, relative to the project, as messages name it. */
  readonly rootFile: string;
  /** The Definitions Packages the root lists, each the one imported package that exports it. */
  readonly packages: readonly ResolvedDefinitions[];
  /** Every imported module that exports a Definitions object, as Node resolved it. */
  readonly definitionsPackages: readonly ResolvedDefinitions[];
  /** Every module of a package the root's import reached, as Node resolved it. */
  readonly imported: readonly ImportedPackage[];
};

/** A project read, or the tooling error that stopped reading it. */
export type ReadProject = { readonly kind: 'read'; readonly project: Project } | Tooling;

/**
 * Reads the project in `directory`: its package.json, its configuration, its root and the
 * Definitions Packages the root lists, as installed; each failure is a tooling error.
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
  const { scope, layout = defaultLayout } = config.config;
  const { packages } = resolved;
  const project = {
    directory,
    packageName,
    manifest,
    scope,
    layout,
    root,
    rootExports,
    rootFile,
    packages,
    definitionsPackages: definitionsPackagesOf(imported),
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
