import {
  byCodePoint,
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
import { relativeSpecifierOf, stringLiteralOf } from '../source-text/index.ts';
import type { ExportedEndpoint, ExportedEvent } from './exported-snapshot.ts';
import { type PackageFile, packageModuleOf } from './modules.ts';
import { bindingOf, fileOf, type ProvidedDeclaration, standardRejectionsSibling } from './names.ts';
import { packagePaths } from './paths.ts';

/** What a Service's entry exports: its Endpoints and Events, its defs' types. */
export type ServiceEntry = {
  readonly endpoints: readonly ExportedEndpoint[];
  readonly events: readonly ExportedEvent[];
  readonly defUses: readonly DefUse[];
};

/**
 * A Service's entry: each Endpoint and Event re-exported by its binding, so a Consumer imports only
 * the Elements it uses and a bundler drops the rest; and the types of its recursive defs, so a
 * Consumer that emits declarations can name them.
 */
export function serviceEntryOf({ endpoints, events, defUses }: ServiceEntry): PackageFile {
  const elements = [
    ...endpoints.map(
      ({ endpoint }): ProvidedDeclaration => ({ kind: 'endpoint', name: endpoint.name }),
    ),
    ...events.map(({ name, version }): ProvidedDeclaration => ({ kind: 'event', name, version })),
  ];
  const body = [...elements.map(reExportOf), ...defTypesExportOf(defUses)];
  return packageModuleOf({ path: packagePaths.entry, body });
}

/** An Element re-exported from its own module, by the binding it is declared under there. */
function reExportOf(declared: ProvidedDeclaration): string {
  const specifier = relativeSpecifierOf(packagePaths.entry, fileOf(declared));
  return `export { ${bindingOf(declared)} } from ${stringLiteralOf(specifier)};`;
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
    path: standardRejectionsSibling.path,
    body: [
      `export const ${standardRejectionsSibling.name} = {`,
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
