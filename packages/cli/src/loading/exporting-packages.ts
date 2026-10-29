import type { Reaching } from '@cf-loom/contract/internal';
import type { ImportedPackage } from './imported-packages.ts';

/** A value of one kind that an imported package exports, and the first of its modules that does. */
export type Exporter<Value> = { readonly module: ImportedPackage; readonly value: Value };

/** Each value a predicate picks among the exports of the imported modules, once per package, with the first of the package's modules exporting it. */
export function exportersOf<Value>(
  imported: readonly ImportedPackage[],
  isValue: (candidate: unknown) => candidate is Value,
): readonly Exporter<Value>[] {
  const exporters: Exporter<Value>[] = [];
  for (const module of imported) {
    for (const value of new Set(Object.values(module.exports).filter(isValue))) {
      const known = exporters.some(
        (exporter) =>
          exporter.value === value && exporter.module.manifestPath === module.manifestPath,
      );
      if (!known) {
        exporters.push({ module, value });
      }
    }
  }
  return exporters;
}

/**
 * The packages that export values of one kind, each as `packageOf` makes it from its exporter and
 * the list of the other such packages its files import, directly or through any package, which
 * this fills in.
 */
export function linkedPackagesOf<Value, Package extends Reaching<Package>>(
  imported: readonly ImportedPackage[],
  exporters: readonly Exporter<Value>[],
  packageOf: (exporter: Exporter<Value>, reaches: Package[]) => Package,
): readonly Package[] {
  const found = exporters.map((exporter) => {
    const reaches: Package[] = [];
    const linked = packageOf(exporter, reaches);
    return { manifestPath: exporter.module.manifestPath, linked, reaches };
  });
  const reachableFromPackage = reachFrom(imported);
  for (const entry of found) {
    const reachable = reachableFromPackage(entry.manifestPath);
    for (const other of found) {
      if (other.manifestPath !== entry.manifestPath && reachable.has(other.manifestPath)) {
        entry.reaches.push(other.linked);
      }
    }
  }
  return found.map(({ linked }) => linked);
}

/** Every package, by its package.json's path, that a package's files import, directly or through any package. */
function reachFrom(
  imported: readonly ImportedPackage[],
): (manifestPath: string) => ReadonlySet<string> {
  const graph = importGraphOf(imported);
  return (manifestPath) => reachableFrom(manifestPath, graph);
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
      for (const dependent of graph.get(next) ?? []) {
        pending.push(dependent);
      }
    }
  }
  return reached;
}
