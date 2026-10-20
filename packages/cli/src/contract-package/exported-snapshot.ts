import {
  byCodePoint,
  type EndpointSnapshot,
  type ExportedSnapshot,
} from '@cf-loom/contract/internal';
import { loomNeeds } from '../schema-code/index.ts';
import { jsonLiteralOf } from '../source-text/index.ts';
import { type PackageFile, packageModuleOf } from './modules.ts';
import { packagePaths } from './paths.ts';

/** An Endpoint the package exports, with the identity the Snapshot keys it by. */
export type ExportedEndpoint = { readonly id: string; readonly endpoint: EndpointSnapshot };

/** The Endpoints of the exported Snapshot by name, as the package's entry lists them. */
export function exportedEndpointsOf(exported: ExportedSnapshot): readonly ExportedEndpoint[] {
  return Object.entries(exported.endpoints)
    .map(([id, endpoint]): ExportedEndpoint => ({ id, endpoint }))
    .sort((left, right) => byCodePoint(left.endpoint.name, right.endpoint.name));
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
