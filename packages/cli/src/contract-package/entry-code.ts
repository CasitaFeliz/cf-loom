import type { ServiceSnapshot } from '@casitafeliz/loom-contract/internal';
import { noNeeds } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { type PackageFile, packageModuleOf } from './modules.ts';
import { endpointFileOf } from './names.ts';
import type { ExportedEndpoint } from './reached.ts';

/** The entry of the package, as its `exports` names it once built. */
const entryFile = 'src/index.ts';

const snapshotModule = 'src/snapshot.ts';
const standardRejectionsModule = 'src/standard-rejections.ts';

/** The version a Contract Package carries until `publish` derives one. */
export const localVersion = '0.0.0';

/**
 * A Service's entry: `contract`, its Endpoints by name, its Events by name in code and its
 * Standard Rejections resolved, checked against `ContractPackage`; and its `snapshot`.
 */
export function serviceEntryOf(name: string, endpoints: readonly ExportedEndpoint[]): PackageFile {
  const names = endpoints.map(({ endpoint }) => endpoint.name);
  const endpointsLines =
    names.length === 0
      ? ['  endpoints: {},']
      : ['  endpoints: {', ...names.map((endpoint) => `    ${endpoint},`), '  },'];
  const body = [
    'export const contract = {',
    `  name: ${stringLiteralOf(name)},`,
    `  version: ${stringLiteralOf(localVersion)},`,
    ...endpointsLines,
    '  events: {},',
    '  standardRejections,',
    '} satisfies ContractPackage;',
    '',
    'export { snapshot };',
  ];
  const siblings = [
    ...names.map((endpoint) => ({ name: endpoint, path: endpointFileOf(endpoint) })),
    { name: 'snapshot', path: snapshotModule },
    { name: 'standardRejections', path: standardRejectionsModule },
  ];
  return packageModuleOf({
    path: entryFile,
    contractNames: [],
    contractTypes: ['ContractPackage'],
    needs: noNeeds(),
    writesSchemas: false,
    siblings,
    body,
  });
}

/** An Application's entry: its `snapshot` only, since it offers no Elements. */
export function applicationEntryOf(): PackageFile {
  return packageModuleOf({
    path: entryFile,
    contractNames: [],
    needs: noNeeds(),
    writesSchemas: false,
    siblings: [{ name: 'snapshot', path: snapshotModule }],
    body: ['export { snapshot };'],
  });
}

/** The Snapshot as a module, so the built package exports what `snapshot.json` holds. */
export function snapshotModuleOf(text: string): PackageFile {
  return packageModuleOf({
    path: snapshotModule,
    contractNames: [],
    needs: noNeeds(),
    writesSchemas: false,
    siblings: [],
    body: [`export const snapshot = ${text.trimEnd()};`],
  });
}

/** The Standard Rejections resolved, as the Snapshot records them, for every Caller. */
export function standardRejectionsModuleOf(snapshot: ServiceSnapshot): PackageFile {
  const names = ['invalidInput', 'notFound', 'notImplemented'] as const;
  const lines = names.map((name) => {
    const { code, status, message } = snapshot.standardRejections[name];
    const fields = `code: ${stringLiteralOf(code)}, status: ${status}, message: ${stringLiteralOf(message)}`;
    return `  ${name}: { ${fields} },`;
  });
  return packageModuleOf({
    path: standardRejectionsModule,
    contractNames: [],
    contractTypes: ['StandardRejections'],
    needs: noNeeds(),
    writesSchemas: false,
    siblings: [],
    body: [
      'export const standardRejections = {',
      ...lines,
      '} as const satisfies StandardRejections;',
    ],
  });
}
