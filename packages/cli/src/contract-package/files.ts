import {
  type ApplicationSnapshot,
  byCodePoint,
  canonicalSnapshotOf,
  canonicalTextOf,
  type ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';
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
import { guardModuleOf } from './guard-code.ts';
import { manifestOf, type Packaging, tsconfigOf } from './manifest.ts';
import { defsFile, type PackageFile, packageModuleOf } from './modules.ts';
import { collidingCodesOf } from './names.ts';
import { type Reached, reachedOf } from './reached.ts';
import { rejectionModuleOf } from './rejection-code.ts';

/** The files of a Contract Package, or the line saying which names cannot be written as code. */
export type ContractPackageFiles =
  | { readonly kind: 'files'; readonly files: readonly PackageFile[] }
  | { readonly kind: 'unnamed'; readonly line: string };

/**
 * The Contract Package of a Service or an Application, generated from its canonical Snapshot
 * alone, so what is published is exactly what the Snapshot describes.
 */
export function contractPackageFilesOf(
  declared: ServiceSnapshot | ApplicationSnapshot,
  packaging: Packaging,
): ContractPackageFiles {
  const snapshot = canonicalSnapshotOf(declared);
  const text = canonicalTextOf(snapshot);
  const packageFiles = [
    manifestOf(snapshot, packaging),
    { path: 'snapshot.json', text },
    tsconfigOf(),
    snapshotModuleOf(text),
  ];
  if (snapshot.kind === 'application') {
    return { kind: 'files', files: [...packageFiles, applicationEntryOf()] };
  }
  const sources = serviceSourcesOf(snapshot);
  if (sources.kind === 'unnamed') {
    return sources;
  }
  return { kind: 'files', files: [...packageFiles, ...sources.files] };
}

/**
 * A Service's sources: the entry, each exported Endpoint, the Guards and codes they reach, and
 * the recursive defs those reach; or why their names cannot be written.
 */
function serviceSourcesOf(snapshot: ServiceSnapshot): ContractPackageFiles {
  const reached = reachedOf(snapshot);
  const endpoints = reached.endpoints.map((exported) => endpointModuleOf(exported, snapshot));
  const guards = reached.guards.map((name) =>
    guardModuleOf(name, declaredIn(snapshot.guards, name)),
  );
  const rejections = reached.codes.map((code) =>
    rejectionModuleOf(code, declaredIn(snapshot.codes, code)),
  );
  const schemaFiles = [...endpoints, ...guards, ...rejections];
  const defUses = reachedDefUsesOf(
    snapshot.defs,
    schemaFiles.flatMap(({ defUses: uses }) => uses),
  );
  const unnamed = unnamedLineOf(reached, defUses);
  if (unnamed !== undefined) {
    return { kind: 'unnamed', line: unnamed };
  }
  const files = [
    serviceEntryOf(snapshot.name, reached.endpoints),
    standardRejectionsModuleOf(snapshot),
    ...schemaFiles.map(({ file }) => file),
    ...defsFilesOf(snapshot, defUses),
  ];
  return { kind: 'files', files };
}

/** The codes or recursion ids the package writes that cannot be names of their own, in one line. */
function unnamedLineOf(reached: Reached, defUses: readonly DefUse[]): string | undefined {
  const codes = collidingCodesOf(reached.codes);
  if (codes !== undefined) {
    return `The codes ${codes[0]} and ${codes[1]} are one name in code: rename one of them`;
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
  snapshot: ServiceSnapshot,
  defUses: readonly DefUse[],
): readonly PackageFile[] {
  if (defUses.length === 0) {
    return [];
  }
  const { body, needs } = defsCodeOf(snapshot.defs, defUses);
  return [packageModuleOf({ path: defsFile, body, needs })];
}

/** A Guard or code the Snapshot holds, since every one an Endpoint reaches is written in it. */
function declaredIn<Declared>(declared: Readonly<Record<string, Declared>>, key: string): Declared {
  const found = declared[key];
  if (found === undefined) {
    throw new Error(`The Snapshot reaches ${key} without declaring it`);
  }
  return found;
}
