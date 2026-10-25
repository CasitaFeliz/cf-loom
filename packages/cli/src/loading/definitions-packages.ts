import { isDefinitions, type ResolvedDefinitions } from '@cf-loom/contract/internal';
import type { ImportedPackage } from './imported-packages.ts';

/** A module that exports a Definitions object, with its version. */
type Versioned = ImportedPackage & { readonly version: string };

/** A Definitions Package found, the package.json it sits under, and the list its reach fills. */
type Found = {
  readonly manifestPath: string;
  readonly resolved: ResolvedDefinitions;
  readonly reaches: ResolvedDefinitions[];
};

/**
 * Every imported module that exports a Definitions object, with that object, and the other ones
 * its package's files import, directly or through any package: the Definitions Packages.
 */
export function definitionsPackagesOf(
  imported: readonly ImportedPackage[],
): readonly ResolvedDefinitions[] {
  const graph = importGraphOf(imported);
  const found = imported.filter(isVersioned).flatMap(definitionsIn);
  for (const entry of found) {
    const reachable = reachableFrom(entry.manifestPath, graph);
    const reached = found.filter(
      (other) => other.manifestPath !== entry.manifestPath && reachable.has(other.manifestPath),
    );
    entry.reaches.push(...reached.map(({ resolved }) => resolved));
  }
  return found.map(({ resolved }) => resolved);
}

/** The imported modules that export a Definitions object but whose package.json has no version. */
export function unversionedDefinitionsOf(
  imported: readonly ImportedPackage[],
): readonly ImportedPackage[] {
  return imported.filter(
    (module) => module.version === undefined && Object.values(module.exports).some(isDefinitions),
  );
}

function definitionsIn(module: Versioned): readonly Found[] {
  const { manifestPath, packageName, version, exports } = module;
  const exported = new Set(Object.values(exports).filter(isDefinitions));
  return [...exported].map((definitions) => {
    const reaches: ResolvedDefinitions[] = [];
    const resolved = { definitions, packageName, version, exports, reaches };
    return { manifestPath, resolved, reaches };
  });
}

/** Which packages each package's files import, each by its package.json's path. */
function importGraphOf(imported: readonly ImportedPackage[]): ReadonlyMap<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const { manifestPath, importedBy } of imported) {
    for (const importer of importedBy) {
      const targets = graph.get(importer) ?? new Set<string>();
      targets.add(manifestPath);
      graph.set(importer, targets);
    }
  }
  return graph;
}

/** Every package a package's files import, at any depth, each visited once. */
function reachableFrom(
  start: string,
  graph: ReadonlyMap<string, Set<string>>,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [...(graph.get(start) ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!reached.has(next)) {
      reached.add(next);
      pending.push(...(graph.get(next) ?? []));
    }
  }
  return reached;
}

function isVersioned(module: ImportedPackage): module is Versioned {
  return module.version !== undefined;
}
