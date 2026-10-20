import {
  byCodePoint,
  type ServiceSnapshot,
  standardRejectionNames,
} from '@cf-loom/contract/internal';
import { type DefUse, defTypeNameOf, loomNeeds } from '../schema-code/index.ts';
import {
  jsonLiteralOf,
  keyOf,
  relativeSpecifierOf,
  stringLiteralOf,
} from '../source-text/index.ts';
import type { ExportedEndpoint } from './exported-snapshot.ts';
import { type PackageFile, packageModuleOf, type Sibling } from './modules.ts';
import { bindingOf, siblingOf } from './names.ts';
import { packagePaths } from './paths.ts';

/** What a Service's entry exports: its name and version, its Endpoints, its defs' types. */
export type ServiceEntry = {
  readonly name: string;
  readonly version: string;
  readonly endpoints: readonly ExportedEndpoint[];
  readonly defUses: readonly DefUse[];
};

/**
 * A Service's entry: `contract`, its Endpoints by name, its Events by name in code, its Standard
 * Rejections resolved and its exported Snapshot, checked against `ContractPackage`; its
 * `snapshot`; and the types of its recursive defs, so a Consumer that emits declarations can
 * name them.
 */
export function serviceEntryOf({ name, version, endpoints, defUses }: ServiceEntry): PackageFile {
  const names = endpoints.map(({ endpoint }) => endpoint.name);
  const entries = names.map(
    (endpoint) => `    ${keyOf(endpoint)}: ${bindingOf({ kind: 'endpoint', name: endpoint })},`,
  );
  const endpointsLines =
    entries.length === 0 ? ['  endpoints: {},'] : ['  endpoints: {', ...entries, '  },'];
  const body = [
    'export const contract = {',
    `  name: ${stringLiteralOf(name)},`,
    `  version: ${stringLiteralOf(version)},`,
    ...endpointsLines,
    '  events: {},',
    '  standardRejections,',
    '  exportedSnapshot,',
    '} satisfies loom.ContractPackage;',
    '',
    'export { snapshot };',
    ...defTypesExportOf(defUses),
  ];
  const siblings: readonly Sibling[] = [
    ...names.map((endpoint) => siblingOf({ kind: 'endpoint', name: endpoint })),
    { name: 'snapshot', path: packagePaths.snapshotModule, kind: 'value' },
    { name: 'exportedSnapshot', path: packagePaths.exportedSnapshot, kind: 'value' },
    { name: 'standardRejections', path: packagePaths.standardRejections, kind: 'value' },
  ];
  return packageModuleOf({ path: packagePaths.entry, body, siblings, needs: loomNeeds() });
}

function defTypesExportOf(defUses: readonly DefUse[]): readonly string[] {
  if (defUses.length === 0) {
    return [];
  }
  const types = defUses.map(({ id, mode }) => defTypeNameOf(id, mode)).sort(byCodePoint);
  const specifier = relativeSpecifierOf(packagePaths.entry, packagePaths.defs);
  return [`export type { ${types.join(', ')} } from ${stringLiteralOf(specifier)};`];
}

/** An Application's entry: its `snapshot` only, since it offers no Elements. */
export function applicationEntryOf(): PackageFile {
  return packageModuleOf({
    path: packagePaths.entry,
    body: ['export { snapshot };'],
    siblings: [{ name: 'snapshot', path: packagePaths.snapshotModule, kind: 'value' }],
  });
}

/** The Snapshot as a module, so the built package exports what `snapshot.json` holds. */
export function snapshotModuleOf(snapshot: unknown): PackageFile {
  return packageModuleOf({
    path: packagePaths.snapshotModule,
    body: [`export const snapshot = ${jsonLiteralOf(snapshot, 'indented')};`],
  });
}

/** The Standard Rejections resolved, as the Snapshot records them, for every Caller. */
export function standardRejectionsModuleOf(snapshot: ServiceSnapshot): PackageFile {
  const lines = standardRejectionNames.map((name) => {
    const { code, status, message } = snapshot.standardRejections[name];
    const fields = `code: ${stringLiteralOf(code)}, status: ${status}, message: ${stringLiteralOf(message)}`;
    return `  ${name}: { ${fields} },`;
  });
  return packageModuleOf({
    path: packagePaths.standardRejections,
    body: [
      'export const standardRejections = {',
      ...lines,
      '} as const satisfies loom.StandardRejections;',
    ],
    needs: loomNeeds(),
  });
}
