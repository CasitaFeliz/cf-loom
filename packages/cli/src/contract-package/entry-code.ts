import {
  byCodePoint,
  codeNameOf,
  type SchemaNode,
  type ServiceSnapshot,
  standardRejectionNames,
} from '@cf-loom/contract/internal';
import {
  type DefUse,
  defTypeNameOf,
  loomNeeds,
  type Writing,
  zodExpressionOf,
} from '../schema-code/index.ts';
import {
  jsonLiteralOf,
  keyOf,
  relativeSpecifierOf,
  stringLiteralOf,
} from '../source-text/index.ts';
import type { ExportedEndpoint, ExportedEvent } from './exported-snapshot.ts';
import { type PackageFile, packageModuleOf, type Sibling } from './modules.ts';
import { bindingOf, type PackagedDeclaration, siblingOf } from './names.ts';
import { packagePaths } from './paths.ts';

/** What a Service's entry exports: its name and version, its Endpoints and Events, its defs' types. */
export type ServiceEntry = {
  readonly name: string;
  readonly version: string;
  readonly endpoints: readonly ExportedEndpoint[];
  readonly events: readonly ExportedEvent[];
  readonly defUses: readonly DefUse[];
};

/** A declaration as a map of `contract` lists it, by its key there. */
type Keyed = { readonly key: string; readonly declared: PackagedDeclaration };

/**
 * A Service's entry: `contract`, its Endpoints by name, its Events by name in code, its Standard
 * Rejections resolved and its exported Snapshot, checked against `ContractPackage`; its
 * `snapshot`; and the types of its recursive defs, so a Consumer that emits declarations can
 * name them.
 */
export function serviceEntryOf(entry: ServiceEntry): PackageFile {
  const { name, version, defUses } = entry;
  const endpoints = entry.endpoints.map(({ endpoint }): Keyed => {
    return { key: endpoint.name, declared: { kind: 'endpoint', name: endpoint.name } };
  });
  const events = entry.events.map((event): Keyed => {
    const declared = { kind: 'event', name: event.name, version: event.version } as const;
    return { key: codeNameOf(event), declared };
  });
  const body = [
    'export const contract = {',
    `  name: ${stringLiteralOf(name)},`,
    `  version: ${stringLiteralOf(version)},`,
    ...mapLinesOf('endpoints', endpoints),
    ...mapLinesOf('events', events),
    '  standardRejections,',
    '  exportedSnapshot,',
    '} satisfies loom.ContractPackage;',
    '',
    'export { snapshot };',
    ...defTypesExportOf(defUses),
  ];
  const siblings: readonly Sibling[] = [
    ...[...endpoints, ...events].map(({ declared }) => siblingOf(declared)),
    { name: 'snapshot', path: packagePaths.snapshotModule, kind: 'value' },
    { name: 'exportedSnapshot', path: packagePaths.exportedSnapshot, kind: 'value' },
    { name: 'standardRejections', path: packagePaths.standardRejections, kind: 'value' },
  ];
  return packageModuleOf({ path: packagePaths.entry, body, siblings, needs: loomNeeds() });
}

/** A map of `contract`, each declaration by its key bound to its name in the package. */
function mapLinesOf(field: string, keyed: readonly Keyed[]): readonly string[] {
  if (keyed.length === 0) {
    return [`  ${field}: {},`];
  }
  const lines = keyed.map(({ key, declared }) => `    ${keyOf(key)}: ${bindingOf(declared)},`);
  return [`  ${field}: {`, ...lines, '  },'];
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

/**
 * The Standard Rejections resolved, as the Snapshot records their codes under `codes`, for every
 * Caller; the invalid-input one with the Reader of its body.
 */
export function standardRejectionsModuleOf(
  snapshot: Pick<ServiceSnapshot, 'standardRejections' | 'codes'>,
): PackageFile {
  const reader: Writing = { mode: 'reader', needs: loomNeeds() };
  const lines = standardRejectionNames.flatMap((name) =>
    standardRejectionLinesOf(name, snapshot, reader),
  );
  return packageModuleOf({
    path: packagePaths.standardRejections,
    body: [
      'export const standardRejections = {',
      ...lines,
      '} as const satisfies loom.ProvidedStandardRejections;',
    ],
    needs: reader.needs,
  });
}

function standardRejectionLinesOf(
  name: keyof ServiceSnapshot['standardRejections'],
  { standardRejections, codes }: Pick<ServiceSnapshot, 'standardRejections' | 'codes'>,
  reader: Writing,
): readonly string[] {
  const code = standardRejections[name];
  const held = codes[code];
  if (held === undefined) {
    throw new Error(
      `A Snapshot holds the code of every Standard Rejection: ${code} is missing, a bug.`,
    );
  }
  return [
    `  ${name}: {`,
    `    code: ${stringLiteralOf(code)},`,
    `    status: ${held.status},`,
    `    message: ${stringLiteralOf(held.message)},`,
    ...bodyLinesOf(name, held.body, reader),
    '  },',
  ];
}

/** Only the invalid-input Rejection has a body, which the decoder and `generate` both guarantee. */
function bodyLinesOf(
  name: keyof ServiceSnapshot['standardRejections'],
  body: SchemaNode | null,
  reader: Writing,
): readonly string[] {
  if (name !== 'invalidInput') {
    return [];
  }
  if (body === null) {
    throw new Error('A Snapshot gives the invalid-input code a body: a bug.');
  }
  return [`    body: ${zodExpressionOf(body, reader)},`];
}
