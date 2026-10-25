import { byCodePoint } from '@cf-loom/contract/internal';
import type { ExportedAt } from '../loading/index.ts';
import {
  defaultImportOf,
  headerOf,
  importSpecifierOf,
  keyOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
  stringLiteralOf,
} from '../source-text/index.ts';
import { handlerLocalOf, nameInCodeOf } from './code-names.ts';
import type { DeprecationStamp, Handled } from './handled.ts';
import type { HandlerPath } from './handler-paths.ts';
import { readersTable } from './readers.ts';

/**
 * The Handler map written at `file`: plain data importing each Handler and the `readers` of the
 * readers file, with the stamps of the Deprecated Endpoints, which `serve` takes as it is.
 */
export function handlerMapTextOf(
  mapped: readonly HandlerPath[],
  stamps: readonly DeprecationStamp[],
  { file, readersFile }: { readonly file: string; readonly readersFile: string },
): string {
  const handlerImports = mapped.map(({ handled, path }) => {
    const specifier = relativeSpecifierOf(file, path);
    return { specifier, line: defaultImportOf(handlerLocalOf(handled), specifier) };
  });
  const readersSpecifier = relativeSpecifierOf(file, readersFile);
  const readersImport = {
    specifier: readersSpecifier,
    line: namedImportOf([readersTable], readersSpecifier),
  };
  const imports = [...handlerImports, readersImport]
    .sort((left, right) => byCodePoint(left.specifier, right.specifier))
    .map(({ line }) => line);
  const handled = mapped.map(({ handled }) => handled);
  const endpoints = handled.filter((element) => element.kind === 'endpoint');
  const guards = handled.filter((element) => element.kind === 'guard');
  const commands = handled.filter((element) => element.kind === 'command');
  const subscriptions = handled.filter((element) => element.kind === 'subscription');
  const body = [
    'export default {',
    ...mapLinesOf('endpoints', endpoints),
    ...mapLinesOf('guards', guards),
    ...mapLinesOf('commands', commands),
    ...mapLinesOf('subscriptions', subscriptions),
    `  ${readersTable},`,
    ...stampLinesOf(stamps),
    '};',
  ];
  return moduleTextOf({ first: [headerOf('generate')], imports, body });
}

/**
 * What a stub hands to `handle.stub`: the export it imports under `local`, and the members read
 * from it, none for `getOrder`, `commands` and `chargeCardV1` for `readers.commands.chargeCardV1`.
 */
export type StubTarget = {
  readonly imported: ExportedAt;
  readonly local: string;
  readonly members: readonly string[];
};

/** The target that is the export itself, imported under the declaration's name in code. */
export function exportedTargetOf(imported: ExportedAt, local: string): StubTarget {
  return { imported, local, members: [] };
}

/** The stub of the Handler at `path`, importing what it is written for from where it is exported. */
export function stubTextOf(path: string, { imported, local, members }: StubTarget): string {
  const specifier = specifierOf(path, imported);
  const imports = [
    namedImportOf(['handle'], '@cf-loom/handlers'),
    namedImportOf([importSpecifierOf(imported.name, local)], specifier),
  ];
  return moduleTextOf({
    first: [],
    imports,
    body: [`export default handle.stub(${[local, ...members].join('.')});`],
  });
}

/** How a file imports an export: a file by its relative path, a package as the project does. */
function specifierOf(importer: string, exported: ExportedAt): string {
  switch (exported.kind) {
    case 'file':
      return relativeSpecifierOf(importer, exported.path);
    case 'package':
      return exported.specifier;
  }
}

function mapLinesOf(key: string, handled: readonly Handled[]): readonly string[] {
  if (handled.length === 0) {
    return [`  ${key}: {},`];
  }
  const entries = handled.map(
    (element) => `    ${keyOf(nameInCodeOf(element))}: ${handlerLocalOf(element)},`,
  );
  return [`  ${key}: {`, ...entries, '  },'];
}

function stampLinesOf(stamps: readonly DeprecationStamp[]): readonly string[] {
  if (stamps.length === 0) {
    return ['  deprecatedAt: {},'];
  }
  const entries = stamps.map(
    ({ name, deprecatedAt }) => `    ${keyOf(name)}: ${stringLiteralOf(deprecatedAt)},`,
  );
  return ['  deprecatedAt: {', ...entries, '  },'];
}
