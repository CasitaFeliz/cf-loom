import {
  type ApplicationSnapshot,
  byCodePoint,
  type ExportedSnapshot,
  exportedSnapshotOf,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import {
  type DefUse,
  defNamesProblemOf,
  defsCodeOf,
  reachedDefUsesOf,
} from '../schema-code/index.ts';
import { endpointModuleOf } from './endpoint-code.ts';
import {
  applicationEntryOf,
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
import { manifestOf, type Packaging, tsconfigOf } from './manifest.ts';
import { type PackageFile, packageModuleOf, type SchemaFile } from './modules.ts';
import { collidingCodesOf } from './names.ts';
import { packagePaths } from './paths.ts';
import { rejectionModuleOf } from './rejection-code.ts';

/** The files of a Contract Package, or the line saying which names cannot be written as code. */
export type ContractPackageFiles =
  | { readonly kind: 'files'; readonly files: readonly PackageFile[] }
  | { readonly kind: 'unnamed'; readonly line: string };

/** A Snapshot in canonical order, every map in code point order, with its canonical text. */
export type CanonicalSnapshot = {
  readonly snapshot: ServiceSnapshot | ApplicationSnapshot;
  readonly text: string;
};

/**
 * The Contract Package of a Service or an Application, generated from its canonical Snapshot
 * alone, so what is published is exactly what the Snapshot describes, in the Snapshot's order.
 */
export function contractPackageFilesOf(
  { snapshot, text }: CanonicalSnapshot,
  packaging: Packaging,
): ContractPackageFiles {
  const packageFiles = [
    manifestOf(snapshot, packaging),
    { path: packagePaths.snapshot, text },
    tsconfigOf(),
    snapshotModuleOf(snapshot),
  ];
  if (snapshot.kind === 'application') {
    return { kind: 'files', files: [...packageFiles, applicationEntryOf()] };
  }
  const sources = serviceSourcesOf(snapshot, packaging.version);
  if (sources.kind === 'unnamed') {
    return sources;
  }
  return { kind: 'files', files: [...packageFiles, ...sources.files] };
}

/**
 * A Service's sources, written from the Snapshot cut to what it exports: the entry, each exported
 * Endpoint and Event, the Guards and codes they reach, and the recursive defs those reach; or why
 * their names cannot be written.
 */
function serviceSourcesOf(snapshot: ServiceSnapshot, version: string): ContractPackageFiles {
  const exported = exportedSnapshotOf(snapshot);
  const endpoints = exportedEndpointsOf(exported);
  const events = exportedEventsOf(exported);
  const schemaFiles = schemaFilesOf(exported, snapshot);
  const defUses = reachedDefUsesOf(
    exported.defs,
    schemaFiles.flatMap(({ defUses: uses }) => uses),
  );
  const unnamed = unnamedLineOf(Object.keys(exported.codes), defUses);
  if (unnamed !== undefined) {
    return { kind: 'unnamed', line: unnamed };
  }
  const files = [
    serviceEntryOf({ name: snapshot.name, version, endpoints, events, defUses }),
    exportedSnapshotModuleOf(exported),
    standardRejectionsModuleOf(snapshot),
    ...schemaFiles.map(({ file }) => file),
    ...defsFilesOf(exported, defUses),
  ];
  return { kind: 'files', files };
}

/** The files that write schemas: each exported Endpoint and Event, the Guards and codes they reach. */
function schemaFilesOf(
  exported: ExportedSnapshot,
  snapshot: ServiceSnapshot,
): readonly SchemaFile[] {
  return [
    ...exportedEndpointsOf(exported).map((endpoint) => endpointModuleOf(endpoint, snapshot)),
    ...exportedEventsOf(exported).map(eventModuleOf),
    ...Object.entries(exported.guards).map(([name, guard]) =>
      guardModuleOf({ kind: 'guard', name }, guard),
    ),
    ...Object.entries(exported.codes).map(([code, declared]) =>
      rejectionModuleOf({ kind: 'rejection', code }, declared),
    ),
  ];
}

/** The codes or recursion ids the package writes that cannot be names of their own, in one line. */
function unnamedLineOf(codes: readonly string[], defUses: readonly DefUse[]): string | undefined {
  const colliding = collidingCodesOf(codes);
  if (colliding !== undefined) {
    return `The codes ${colliding[0]} and ${colliding[1]} are one name in code: rename one of them`;
  }
  const ids = [...new Set(defUses.map(({ id }) => id))].sort(byCodePoint);
  const problem = defNamesProblemOf(ids);
  switch (problem?.kind) {
    case undefined:
      return undefined;
    case 'no-name':
      return `The recursion id ${problem.id} is no name in code: rename it`;
    case 'colliding':
      return `The recursion ids ${problem.ids[0]} and ${problem.ids[1]} are one name in code: rename one of them`;
  }
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
