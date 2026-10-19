import type { ExportedSnapshot, ServiceSnapshot } from '@casitafeliz/loom-contract/internal';
import { loomNeeds } from '../schema-code/index.ts';
import { jsonLiteralOf } from '../source-text/index.ts';
import { type PackageFile, packageModuleOf } from './modules.ts';
import { packagePaths } from './paths.ts';
import type { Reached } from './reached.ts';

/**
 * The Snapshot cut to what the package exports, from the same reach that decides its code: the
 * exported Endpoints, the Guards and codes they reach and the defs those reach, in canonical order.
 */
export function exportedSnapshotOf(
  snapshot: ServiceSnapshot,
  reached: Reached,
  defIds: ReadonlySet<string>,
): ExportedSnapshot {
  const endpointIds = new Set(reached.endpoints.map(({ id }) => id));
  return {
    format: snapshot.format,
    defs: keptOf(snapshot.defs, defIds),
    endpoints: keptOf(snapshot.endpoints, endpointIds),
    guards: keptOf(snapshot.guards, new Set(reached.guards)),
    codes: keptOf(snapshot.codes, new Set(reached.codes)),
  };
}

/** The exported Snapshot as a module, typed so the package's `contract` satisfies its type. */
export function exportedSnapshotModuleOf(exported: ExportedSnapshot): PackageFile {
  const literal = jsonLiteralOf(exported, 'indented');
  return packageModuleOf({
    path: packagePaths.exportedSnapshot,
    body: [`export const exportedSnapshot: loom.ExportedSnapshot = ${literal};`],
    needs: loomNeeds(),
  });
}

/** The entries of a Snapshot map whose keys are kept, in the map's order. */
function keptOf<Value>(
  entries: Readonly<Record<string, Value>>,
  kept: ReadonlySet<string>,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => kept.has(key)));
}
