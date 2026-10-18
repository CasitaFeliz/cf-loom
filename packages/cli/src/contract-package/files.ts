import {
  type ApplicationSnapshot,
  canonicalTextOf,
  type ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';
import { collidingDefIdsOf, defsModuleOf } from '../schema-code/index.ts';
import { endpointModuleOf } from './endpoint-code.ts';
import {
  applicationEntryOf,
  serviceEntryOf,
  snapshotModuleOf,
  standardRejectionsModuleOf,
} from './entry-code.ts';
import { guardModuleOf, rejectionModuleOf } from './guard-code.ts';
import { manifestOf, type Packaging, tsconfigOf } from './manifest.ts';
import { defsFile, type PackageFile, type SchemaFile } from './modules.ts';
import { reachedOf } from './reached.ts';

/** The files of a Contract Package, or the two recursion ids that would be one identifier in code. */
export type ContractPackageFiles =
  | { readonly kind: 'files'; readonly files: readonly PackageFile[] }
  | { readonly kind: 'colliding-defs'; readonly ids: readonly [string, string] };

/**
 * The Contract Package of a Service or an Application, generated from its Snapshot alone: its
 * package.json, `snapshot.json`, tsconfig and sources, so what is published is exactly what the
 * Snapshot describes.
 */
export function contractPackageFilesOf(
  snapshot: ServiceSnapshot | ApplicationSnapshot,
  packaging: Packaging,
): ContractPackageFiles {
  const text = canonicalTextOf(snapshot);
  const common = [
    manifestOf(snapshot, packaging),
    { path: 'snapshot.json', text },
    tsconfigOf(),
    snapshotModuleOf(text),
  ];
  if (snapshot.kind === 'application') {
    return { kind: 'files', files: [...common, applicationEntryOf()] };
  }
  const colliding = collidingDefIdsOf(snapshot.defs);
  if (colliding !== undefined) {
    return { kind: 'colliding-defs', ids: colliding };
  }
  return { kind: 'files', files: [...common, ...serviceSourcesOf(snapshot)] };
}

/** A Service's sources: the entry, each exported Endpoint, the Guards and codes they reach, the defs. */
function serviceSourcesOf(snapshot: ServiceSnapshot): readonly PackageFile[] {
  const reached = reachedOf(snapshot);
  const endpoints = reached.endpoints.map((exported) => endpointModuleOf(exported, snapshot));
  const guards = reached.guards.map((name) =>
    guardModuleOf(name, declaredIn(snapshot.guards, name)),
  );
  const rejections = reached.codes.map((code) =>
    rejectionModuleOf(code, declaredIn(snapshot.codes, code)),
  );
  const schemaFiles = [...endpoints, ...guards, ...rejections];
  return [
    serviceEntryOf(snapshot.name, reached.endpoints),
    standardRejectionsModuleOf(snapshot),
    ...schemaFiles.map(({ file }) => file),
    ...defsFilesOf(snapshot, schemaFiles),
  ];
}

function defsFilesOf(
  snapshot: ServiceSnapshot,
  schemaFiles: readonly SchemaFile[],
): readonly PackageFile[] {
  const referenced = new Set(schemaFiles.flatMap(({ defs }) => [...defs]));
  if (referenced.size === 0) {
    return [];
  }
  return [{ path: defsFile, text: defsModuleOf(snapshot.defs, referenced) }];
}

/** A Guard or code the Snapshot holds, since every one an Endpoint reaches is written in it. */
function declaredIn<Declared>(declared: Readonly<Record<string, Declared>>, key: string): Declared {
  const found = declared[key];
  if (found === undefined) {
    throw new Error(`The Snapshot reaches ${key} without declaring it`);
  }
  return found;
}
