import { type ServiceSnapshot, standardRejectionNames } from '@casitafeliz/loom-contract/internal';
import { keyOf, stringLiteralOf } from '../source-text/index.ts';
import { localVersion } from './manifest.ts';
import { loomNeeds, type PackageFile, packageModuleOf, type Sibling } from './modules.ts';
import { endpointBindingOf, endpointFileOf } from './names.ts';
import type { ExportedEndpoint } from './reached.ts';

const entryFile = 'src/index.ts';
const snapshotModule = 'src/snapshot.ts';
const standardRejectionsModule = 'src/standard-rejections.ts';

/**
 * A Service's entry: `contract`, its Endpoints by name, its Events by name in code and its
 * Standard Rejections resolved, checked against `ContractPackage`; and its `snapshot`.
 */
export function serviceEntryOf(name: string, endpoints: readonly ExportedEndpoint[]): PackageFile {
  const names = endpoints.map(({ endpoint }) => endpoint.name);
  const entries = names.map(
    (endpoint) => `    ${keyOf(endpoint)}: ${endpointBindingOf(endpoint)},`,
  );
  const endpointsLines =
    entries.length === 0 ? ['  endpoints: {},'] : ['  endpoints: {', ...entries, '  },'];
  const body = [
    'export const contract = {',
    `  name: ${stringLiteralOf(name)},`,
    `  version: ${stringLiteralOf(localVersion)},`,
    ...endpointsLines,
    '  events: {},',
    '  standardRejections,',
    '} satisfies loom.ContractPackage;',
    '',
    'export { snapshot };',
  ];
  const siblings: readonly Sibling[] = [
    ...names.map(
      (endpoint): Sibling => ({
        name: endpointBindingOf(endpoint),
        path: endpointFileOf(endpoint),
        kind: 'value',
      }),
    ),
    { name: 'snapshot', path: snapshotModule, kind: 'value' },
    { name: 'standardRejections', path: standardRejectionsModule, kind: 'value' },
  ];
  return packageModuleOf({ path: entryFile, body, siblings, needs: loomNeeds() });
}

/** An Application's entry: its `snapshot` only, since it offers no Elements. */
export function applicationEntryOf(): PackageFile {
  return packageModuleOf({
    path: entryFile,
    body: ['export { snapshot };'],
    siblings: [{ name: 'snapshot', path: snapshotModule, kind: 'value' }],
  });
}

/** The Snapshot as a module, so the built package exports what `snapshot.json` holds. */
export function snapshotModuleOf(text: string): PackageFile {
  return packageModuleOf({
    path: snapshotModule,
    body: [`export const snapshot = ${text.trimEnd()};`],
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
    path: standardRejectionsModule,
    body: [
      'export const standardRejections = {',
      ...lines,
      '} as const satisfies loom.StandardRejections;',
    ],
    needs: loomNeeds(),
  });
}
