import {
  byCodePoint,
  codeNameOf,
  type EventSnapshot,
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
import { keyOf, relativeSpecifierOf, stringLiteralOf } from '../source-text/index.ts';
import { deprecatedLinesOf } from './element-lines.ts';
import type { ExportedEndpoint, ExportedEvent } from './exported-snapshot.ts';
import { type PackageFile, packageModuleOf, type Sibling } from './modules.ts';
import { bindingOf, type PackagedDeclaration, siblingOf } from './names.ts';
import { packagePaths } from './paths.ts';

/** What a Service's entry exports: its name, its Endpoints and Events, its defs' types. */
export type ServiceEntry = {
  readonly name: string;
  readonly endpoints: readonly ExportedEndpoint[];
  readonly events: readonly ExportedEvent[];
  readonly defUses: readonly DefUse[];
};

/** A declaration as a map of `contract` lists it, by its key there, with the Element it declares. */
type Keyed = {
  readonly key: string;
  readonly declared: PackagedDeclaration;
  readonly element: Pick<EventSnapshot, 'description' | 'lifecycle'>;
};

/**
 * A Service's entry: `contract`, its Endpoints by name, its Events by name in code, its Standard
 * Rejections resolved and its exported Snapshot, checked against `ContractPackage` and declared
 * with a type that names each by `typeof`, so its declaration stays small and keeps the literal
 * name, which `satisfies` would widen without `as const`; and the types of its recursive defs, so a Consumer that emits declarations can name them.
 */
export function serviceEntryOf(entry: ServiceEntry): PackageFile {
  const { name, defUses } = entry;
  const endpoints = entry.endpoints.map(({ endpoint }): Keyed => {
    const declared = { kind: 'endpoint', name: endpoint.name } as const;
    return { key: endpoint.name, declared, element: endpoint };
  });
  const events = entry.events.map((event): Keyed => {
    const declared = { kind: 'event', name: event.name, version: event.version } as const;
    return { key: codeNameOf(event), declared, element: event.event };
  });
  const body = [
    'export const contract: {',
    `  readonly name: ${stringLiteralOf(name)};`,
    ...typeLinesOf('endpoints', endpoints),
    ...typeLinesOf('events', events),
    '  readonly standardRejections: typeof standardRejections;',
    '  readonly exportedSnapshot: unknown;',
    '} = {',
    `  name: ${stringLiteralOf(name)} as const,`,
    ...mapLinesOf('endpoints', endpoints),
    ...mapLinesOf('events', events),
    '  standardRejections,',
    '  exportedSnapshot,',
    '} satisfies loom.ContractPackage;',
    ...defTypesExportOf(defUses),
  ];
  const siblings: readonly Sibling[] = [
    ...[...endpoints, ...events].map(({ declared }) => siblingOf(declared)),
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

/** The type of a map of `contract`, each key typed by its declaration, a Deprecated one's marked `@deprecated` so a Consumer's editor flags each use. */
function typeLinesOf(field: string, keyed: readonly Keyed[]): readonly string[] {
  if (keyed.length === 0) {
    return [`  readonly ${field}: {};`];
  }
  const lines = keyed.flatMap(({ key, declared, element }) => [
    ...deprecatedLinesOf(element, '    '),
    `    readonly ${keyOf(key)}: typeof ${bindingOf(declared)};`,
  ]);
  return [`  readonly ${field}: {`, ...lines, '  };'];
}

function defTypesExportOf(defUses: readonly DefUse[]): readonly string[] {
  if (defUses.length === 0) {
    return [];
  }
  const types = defUses.map(({ id, mode }) => defTypeNameOf(id, mode)).sort(byCodePoint);
  const specifier = relativeSpecifierOf(packagePaths.entry, packagePaths.defs);
  return [`export type { ${types.join(', ')} } from ${stringLiteralOf(specifier)};`];
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
