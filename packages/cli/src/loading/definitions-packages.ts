import type { Definitions } from '@cf-loom/contract';
import { type ImportedDefinitions, isDefinitions } from '@cf-loom/contract/internal';
import type { ImportedPackage } from './imported-packages.ts';

/** A Definitions object of one package, read from the first of its modules that exports it. */
type Exporter = { readonly module: ImportedPackage; readonly definitions: Definitions };

/** A Definitions Package found, the package.json it sits under, and the list its reach fills. */
type Found = {
  readonly manifestPath: string;
  readonly imported: ImportedDefinitions;
  readonly reaches: ImportedDefinitions[];
};

/**
 * Every Definitions object an imported package exports, once per package however many of its
 * modules export it, each package as its package.json names it or not; with the other packages
 * its files import, directly or through any package.
 */
export function definitionsPackagesOf(
  imported: readonly ImportedPackage[],
): readonly ImportedDefinitions[] {
  const found: Found[] = exportersOf(imported).map(({ module, definitions }) => {
    const { identity, exports, manifestPath } = module;
    const reaches: ImportedDefinitions[] = [];
    return { manifestPath, imported: { ...identity, definitions, exports, reaches }, reaches };
  });
  const graph = importGraphOf(imported);
  for (const entry of found) {
    const reachable = reachableFrom(entry.manifestPath, graph);
    const reached = found.filter(
      (other) => other.manifestPath !== entry.manifestPath && reachable.has(other.manifestPath),
    );
    entry.reaches.push(...reached.map((other) => other.imported));
  }
  return found.map((entry) => entry.imported);
}

/** Each Definitions object once per package, with the first of the package's modules exporting it. */
function exportersOf(imported: readonly ImportedPackage[]): readonly Exporter[] {
  const exporters: Exporter[] = [];
  for (const module of imported) {
    for (const definitions of new Set(Object.values(module.exports).filter(isDefinitions))) {
      const known = exporters.some(
        (exporter) =>
          exporter.definitions === definitions &&
          exporter.module.manifestPath === module.manifestPath,
      );
      if (!known) {
        exporters.push({ module, definitions });
      }
    }
  }
  return exporters;
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
