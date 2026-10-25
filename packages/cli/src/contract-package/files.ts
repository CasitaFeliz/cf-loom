import {
  type ExportedSnapshot,
  exportedSnapshotOf,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import { type DefUse, defsCodeOf, reachedDefUsesOf } from '../schema-code/index.ts';
import { endpointModuleOf } from './endpoint-code.ts';
import {
  applicationEntryOf,
  type ServiceEntry,
  serviceEntryOf,
  snapshotModuleOf,
  standardRejectionsModuleOf,
} from './entry-code.ts';
import { eventModuleOf } from './event-code.ts';
import {
  exportedEndpointsOf,
  exportedEventsOf,
  exportedSnapshotModuleOf,
} from './exported-snapshot.ts';
import { guardModuleOf } from './guard-code.ts';
import { type ContractSnapshot, manifestOf, type Packaging, tsconfigOf } from './manifest.ts';
import { type PackageFile, packageModuleOf, type SchemaFile } from './modules.ts';
import { packagePaths } from './paths.ts';
import { rejectionModuleOf } from './rejection-code.ts';

/** A Snapshot in canonical order, every map in code point order, with its canonical text. */
export type CanonicalSnapshot = {
  readonly snapshot: ContractSnapshot;
  readonly text: string;
};

/**
 * The Contract Package of a Service or an Application, generated from its canonical Snapshot
 * alone, declared or published, so what is published is exactly what the Snapshot describes, in
 * the Snapshot's order.
 */
export function contractPackageFilesOf(
  { snapshot, text }: CanonicalSnapshot,
  packaging: Packaging,
): readonly PackageFile[] {
  const packageFiles = [
    manifestOf(snapshot, packaging),
    { path: packagePaths.snapshot, text },
    tsconfigOf(),
    snapshotModuleOf(snapshot),
  ];
  if (snapshot.kind === 'application') {
    return [...packageFiles, applicationEntryOf()];
  }
  return [...packageFiles, ...serviceSourcesOf(snapshot, packaging.version)];
}

/**
 * A Service's sources, written from the Snapshot cut to what it exports: the entry, each exported
 * Endpoint and Event, the Guards and codes they reach, and the recursive defs those reach.
 */
function serviceSourcesOf(
  snapshot: ServiceSnapshot | PublishedServiceSnapshot,
  version: string,
): readonly PackageFile[] {
  const exported = exportedSnapshotOf(snapshot);
  const endpoints = exportedEndpointsOf(exported);
  const events = exportedEventsOf(exported);
  const schemaFiles = schemaFilesOf({ endpoints, events }, exported, snapshot);
  const defUses = reachedDefUsesOf(
    exported.defs,
    schemaFiles.flatMap(({ defUses: uses }) => uses),
  );
  return [
    serviceEntryOf({ name: snapshot.name, version, endpoints, events, defUses }),
    exportedSnapshotModuleOf(exported),
    standardRejectionsModuleOf(snapshot),
    ...schemaFiles.map(({ file }) => file),
    ...defsFilesOf(exported, defUses),
  ];
}

/** The files that write schemas: each exported Endpoint and Event, the Guards and codes they reach. */
function schemaFilesOf(
  { endpoints, events }: Pick<ServiceEntry, 'endpoints' | 'events'>,
  exported: ExportedSnapshot,
  snapshot: Pick<ServiceSnapshot, 'standardRejections' | 'guards'>,
): readonly SchemaFile[] {
  return [
    ...endpoints.map((endpoint) => endpointModuleOf(endpoint, snapshot)),
    ...events.map(eventModuleOf),
    ...Object.entries(exported.guards).map(([name, guard]) =>
      guardModuleOf({ kind: 'guard', name }, guard),
    ),
    ...Object.entries(exported.codes).map(([code, declared]) =>
      rejectionModuleOf({ kind: 'rejection', code }, declared),
    ),
  ];
}

function defsFilesOf(
  exported: ExportedSnapshot,
  defUses: readonly DefUse[],
): readonly PackageFile[] {
  if (defUses.length === 0) {
    return [];
  }
  const { body, needs } = defsCodeOf(exported.defs, defUses);
  return [packageModuleOf({ path: packagePaths.defs, body, needs })];
}
